"""Integration tests mapped to the acceptance criteria of the first milestone.

They run the real pipeline against a real PostgreSQL database (planb_test) on a synthetic document
fixture. Each test names the criterion it proves.
"""

from __future__ import annotations

import json
import subprocess
import uuid

import httpx
import psycopg
import pytest

from planb_research.adapters.base import DocumentRef, FetchFailed, IngestionRefused, ManualUploadAdapter, SourceAdapter
from planb_research.pipeline import Worker, enqueue, stages
from planb_research.pipeline.runner import NonRetryableError
from planb_research.storage import LocalEvidenceStore

from .conftest import ADMIN, RESEARCHER, REVIEWER, as_user
from .fixtures import minimal_pdf


def one(conn, sql, *params):
    return conn.execute(sql, params).fetchone()


# ── AC: real permitted source documents can be ingested ──────────────────────
class TestIngestion:
    def _adapter(self, conn, settings, source, transport=None, cls=SourceAdapter):
        class A(cls):
            source_slug = source["slug"]
            adapter_key = "test"

        client = httpx.Client(transport=transport, headers={"User-Agent": settings.user_agent}) if transport else None
        return A(conn, LocalEvidenceStore(settings.evidence_dir), settings=settings, client=client, sleep=lambda s: None)

    def test_manual_upload_hashes_stores_and_deduplicates(self, conn, settings, factory, tmp_path):
        source = factory.source()
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(minimal_pdf([f"Synthetic fixture {uuid.uuid4()}", "Synthetic grinder 2 200000 400000"]))
        adapter = ManualUploadAdapter(conn, LocalEvidenceStore(settings.evidence_dir), source["slug"], settings=settings)
        first = adapter.ingest_file(pdf, DocumentRef(url=None, title="Synthetic", data_origin="test"))
        second = adapter.ingest_file(pdf, DocumentRef(url=None, title="Synthetic again", data_origin="test"))
        assert not first.was_duplicate and second.was_duplicate and first.document_id == second.document_id
        doc = one(conn, "select * from intel.source_documents where id = %s", first.document_id)
        assert doc["sha256"] == first.sha256 and doc["mime_type"] == "application/pdf" and doc["retrieval_method"] == "manual_upload"
        assert (settings.evidence_dir / doc["storage_path"]).exists()
        actions = [r["action"] for r in conn.execute("select action from ops.ingestion_log where document_id = %s order by id", (first.document_id,))]
        assert actions == ["store", "dedupe_hit"]

    def test_non_pdf_content_is_refused_regardless_of_name(self, conn, settings, factory, tmp_path):
        source = factory.source()
        fake = tmp_path / "report.pdf"
        fake.write_bytes(b"<html><script>alert(1)</script></html>")
        adapter = ManualUploadAdapter(conn, LocalEvidenceStore(settings.evidence_dir), source["slug"], settings=settings)
        with pytest.raises(IngestionRefused, match="unsupported file type"):
            adapter.ingest_file(fake, DocumentRef(url=None, title="x"))

    def test_automated_fetch_refused_unless_registry_enables_it(self, conn, settings, factory):
        source = factory.source(reuse_status="permission_required")
        adapter = self._adapter(conn, settings, source, httpx.MockTransport(lambda r: httpx.Response(200, content=minimal_pdf(["x"]))))
        with pytest.raises(IngestionRefused, match="not enabled"):
            adapter.ingest(DocumentRef(url="https://example.invalid/a.pdf", title="x"))

    def test_database_refuses_to_enable_ingestion_without_reuse_rights(self, conn, factory):
        source = factory.source(reuse_status="permission_required")
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("update intel.sources set ingestion_enabled = true where id = %s", (source["id"],))
        conn.rollback()
        # recorded written permission is the only way to lift the gate for such a source
        conn.execute("update intel.sources set permission_granted_on = current_date, permission_evidence = 'email ref', ingestion_enabled = true where id = %s", (source["id"],))
        conn.commit()

    def _enabled_source(self, conn, factory):
        source = factory.source()
        conn.execute("update intel.sources set ingestion_enabled = true where id = %s", (source["id"],))
        conn.commit()
        return source

    def test_robots_txt_is_honoured(self, conn, settings, factory):
        source = self._enabled_source(conn, factory)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nDisallow: /private/\n", headers={"content-type": "text/plain"})
            return httpx.Response(200, content=minimal_pdf([f"robots fixture {uuid.uuid4()}"]))

        adapter = self._adapter(conn, settings, source, httpx.MockTransport(handler))
        with pytest.raises(IngestionRefused, match="robots.txt disallows"):
            adapter.ingest(DocumentRef(url="https://example.invalid/private/a.pdf", title="x", data_origin="test"))
        assert not adapter.ingest(DocumentRef(url="https://example.invalid/public/a.pdf", title="x", data_origin="test")).was_duplicate

    def test_transient_failures_are_retried_then_succeed(self, conn, settings, factory):
        source = self._enabled_source(conn, factory)
        calls = {"n": 0}
        body = minimal_pdf([f"retry fixture {uuid.uuid4()}"])

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            calls["n"] += 1
            return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, content=body)

        adapter = self._adapter(conn, settings, source, httpx.MockTransport(handler))
        doc = adapter.ingest(DocumentRef(url="https://example.invalid/a.pdf", title="x", data_origin="test"))
        assert calls["n"] == 3 and doc.byte_size == len(body)
        outcomes = [r["outcome"] for r in conn.execute("select outcome from ops.ingestion_log where source_id = %s and action = 'fetch' order by id", (source["id"],))]
        assert outcomes == ["failed", "failed", "ok"]

    def test_permanent_failure_gives_up_after_bounded_attempts(self, conn, settings, factory):
        source = self._enabled_source(conn, factory)
        handler = lambda r: httpx.Response(404) if r.url.path == "/robots.txt" else httpx.Response(503)  # noqa: E731
        with pytest.raises(FetchFailed, match="after 4 attempts"):
            self._adapter(conn, settings, source, httpx.MockTransport(handler)).ingest(DocumentRef(url="https://example.invalid/a.pdf", title="x"))


# ── AC: the entire workflow functions end to end ─────────────────────────────
class TestEndToEnd:
    def test_document_to_submitted_version(self, conn, factory):
        r = factory.run_document()
        assert r["run"]["status"] == "succeeded", r["run"]["error"]
        steps = conn.execute("select stage, status from ops.research_run_steps where run_id = %s order by sequence_no", (r["run"]["id"],)).fetchall()
        assert [s["stage"] for s in steps] == ["ingest_document", "extract_claims", "normalize_claims", "structure_record", "cross_verify",
                                               "build_model", "analyze_gaps", "submit_for_review"]
        assert all(s["status"] == "succeeded" for s in steps)
        model_id = r["model"]["id"]
        # AC: business records are stored in a structured relational database
        assert one(conn, "select count(*) as n from intel.cost_items where business_variant_id = %s", r["variant"]["id"])["n"] >= 9
        assert one(conn, "select count(*) as n from intel.revenue_streams where business_variant_id = %s", r["variant"]["id"])["n"] == 1
        assert one(conn, "select count(*) as n from intel.financial_scenarios fs where business_variant_id = %s and is_current", r["variant"]["id"])["n"] >= 10
        assert one(conn, "select count(*) as n from intel.research_tasks where business_model_id = %s and status = 'open'", model_id)["n"] > 5
        version = one(conn, "select * from intel.business_versions where business_model_id = %s", model_id)
        assert version["status"] == "submitted" and version["version_no"] == 1 and version["submitted_by_run"] == r["run"]["id"]
        assert one(conn, "select lifecycle_status from intel.business_models where id = %s", model_id)["lifecycle_status"] == "in_review"

    def test_normalisation_converts_units_and_periods(self, conn, factory):
        r = factory.run_document()
        misc = one(conn, """select o.value from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id
                            where ci.business_variant_id = %s and ci.key = 'miscellaneous_fixed_assets'""", r["variant"]["id"])
        assert misc["value"] == 100000  # "1.00" printed "(in Lacs)"
        cap = one(conn, "select value, period, analyst_notes from intel.parameter_observations where business_variant_id = %s and parameter_key = 'capacity_units_per_month'", r["variant"]["id"])
        assert cap["value"] == 10000 and cap["period"] == "per_month" and "divided by 12" in cap["analyst_notes"]


# ── AC: extracted claims are linked to supporting evidence ───────────────────
class TestEvidenceLinks:
    def test_every_observation_has_a_passport_back_to_a_verified_quote(self, conn, factory):
        r = factory.run_document()
        rows = conn.execute(
            """select o.id, o.source_id, o.source_document_id, o.page_ref, o.observed_on, o.evidence_type, o.evidence_grade,
                      c.quote, c.quote_verified, c.page_no
               from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id
               left join intel.evidence_links l on l.target_table = 'cost_observations' and l.target_id = o.id
               left join intel.evidence_claims c on c.id = l.claim_id
               where ci.business_variant_id = %s""", (r["variant"]["id"],)).fetchall()
        assert rows
        for o in rows:
            assert o["quote_verified"] is True and o["quote"] and o["page_no"]
            assert o["source_document_id"] == r["doc"]["id"] and o["page_ref"] == f"p. {o['page_no']}"
            assert o["evidence_type"] == "government_project_report" and o["evidence_grade"] == "C"

    def test_claim_whose_quote_is_not_in_the_document_is_never_materialised(self, conn, factory, monkeypatch):
        from planb_research.extract import niftem_rules
        from planb_research.extract.schemas import ExtractedClaim

        real = niftem_rules.extract

        def with_hallucination(pages):
            result = real(pages)
            result.claims.append(ExtractedClaim(page_no=5, quote="Phantom machine 1 999999 999999", claim_type="cost", subject="Phantom machine",
                                                value_numeric=999999, unit_raw="Rs.", quantity=1, target_kind="cost_item", cost_category_slug="capex.machinery"))
            return result

        monkeypatch.setattr(niftem_rules, "extract", with_hallucination)
        r = factory.run_document()
        phantom = one(conn, "select * from intel.evidence_claims where source_document_id = %s and subject = 'Phantom machine'", r["doc"]["id"])
        assert phantom["quote_verified"] is False
        assert one(conn, "select count(*) as n from intel.cost_items where business_variant_id = %s and key = 'phantom_machine'", r["variant"]["id"])["n"] == 0
        # and a human cannot accept it either: acceptance requires the quote to exist in the document
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("update intel.evidence_claims set status = 'accepted', reviewed_at = now() where id = %s", (phantom["id"],))
        conn.rollback()

    def test_re_extraction_is_idempotent(self, conn, factory):
        r = factory.run_document()
        obs_sql = "select count(*) as n from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id where ci.business_variant_id = %s"
        before = one(conn, "select count(*) as n from intel.evidence_claims where source_document_id = %s", r["doc"]["id"])["n"]
        obs_before = one(conn, obs_sql, r["variant"]["id"])["n"]
        assert obs_before == 11  # 2 machines, misc assets, 2 staff roles, power, maintenance, raw material, packaging, rent, admin
        run = enqueue(conn, "document_research", business_model_id=r["model"]["id"], source_document_id=r["doc"]["id"], data_origin="test", idempotency_key=f"t:{uuid.uuid4()}")
        final = r["worker"].execute(factory._claim(r["worker"], run["id"]))
        assert final["status"] == "succeeded"
        assert one(conn, "select count(*) as n from intel.evidence_claims where source_document_id = %s", r["doc"]["id"])["n"] == before
        assert one(conn, obs_sql, r["variant"]["id"])["n"] == obs_before

    def test_enqueue_is_idempotent(self, conn, factory):
        model = factory.model()
        a = enqueue(conn, "business_refresh", business_model_id=model["id"], idempotency_key="same-key-" + model["slug"], data_origin="test")
        b = enqueue(conn, "business_refresh", business_model_id=model["id"], idempotency_key="same-key-" + model["slug"], data_origin="test")
        assert a["id"] == b["id"] and b.get("_already_existed")


# ── AC: conflicting cost observations can coexist ────────────────────────────
class TestConflicts:
    def _second_observation(self, conn, factory, r, value, origin="test"):
        other = factory.source(origin=origin)
        item = one(conn, "select id from intel.cost_items where business_variant_id = %s and key = 'synthetic_grinder'", r["variant"]["id"])
        return conn.execute(
            """insert into intel.cost_observations (cost_item_id, value, unit_code, period, observed_on, source_id, evidence_type, evidence_grade, data_origin)
               values (%s, %s, 'inr', 'one_time', '2026-06-01', %s, 'manufacturer_catalogue', 'C', %s) returning id""",
            (item["id"], value, other["id"], origin)).fetchone()["id"], item["id"]

    def test_contradictory_observations_are_both_kept_and_flagged(self, conn, factory):
        r = factory.run_document()
        _obs, item_id = self._second_observation(conn, factory, r, 320000)
        conn.commit()
        assert factory.refresh(r["model"]["id"])["status"] == "succeeded"
        obs = conn.execute("select value from intel.cost_observations where cost_item_id = %s order by value", (item_id,)).fetchall()
        assert [float(o["value"]) for o in obs] == [200000, 320000]
        conflict = one(conn, "select * from intel.observation_conflicts where cost_item_id = %s", item_id)
        assert conflict["status"] == "open" and conflict["observation_count"] == 2 and float(conflict["spread_pct"]) > 15
        param = one(conn, "select * from intel.financial_parameters where cost_item_id = %s and is_current", item_id)
        assert float(param["value"]) == 260000 and param["method"] == "median" and "disagree" in param["rationale"]
        assert one(conn, "select count(*) as n from intel.financial_parameter_sources where financial_parameter_id = %s", param["id"])["n"] == 2
        assert one(conn, "select count(*) as n from intel.research_tasks where business_model_id = %s and task_type = 'resolve_conflict' and status = 'open'", r["model"]["id"])["n"] == 1
        # history is retained: the superseded parameter value is still there
        assert one(conn, "select count(*) as n from intel.financial_parameters where cost_item_id = %s and not is_current", item_id)["n"] == 1

    def test_agreeing_independent_sources_upgrade_to_grade_b(self, conn, factory):
        r = factory.run_document()
        obs_id, item_id = self._second_observation(conn, factory, r, 205000)
        conn.commit()
        factory.refresh(r["model"]["id"])
        grades = [o["evidence_grade"] for o in conn.execute("select evidence_grade from intel.cost_observations where cost_item_id = %s", (item_id,))]
        assert grades == ["B", "B"]
        assert one(conn, "select count(*) as n from intel.observation_conflicts where cost_item_id = %s", item_id)["n"] == 0

    def test_an_observation_value_can_never_be_overwritten(self, conn, factory):
        r = factory.run_document()
        obs = one(conn, "select o.id from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id where ci.business_variant_id = %s limit 1", r["variant"]["id"])
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            conn.execute("update intel.cost_observations set value = value * 2 where id = %s", (obs["id"],))
        conn.rollback()
        conn.execute("update intel.cost_observations set analyst_notes = 'checked scale' where id = %s", (obs["id"],))  # review metadata may change
        conn.commit()


# ── AC: financial calculations are reproducible ──────────────────────────────
class TestReproducibility:
    def test_stored_input_reproduces_stored_output(self, conn, factory, settings):
        r = factory.run_document()
        sc = one(conn, "select * from intel.financial_scenarios where business_variant_id = %s and scenario_key = 'base' and is_current", r["variant"]["id"])
        out = subprocess.run(["node", str(settings.finance_cli)], input=json.dumps({"op": "run", "input": sc["input"]["input"]}).encode(), capture_output=True, check=True)
        again = json.loads(out.stdout)
        assert again["inputHash"] == sc["input_hash"] and again["engineVersion"] == sc["engine_version"]
        assert again["summary"] == sc["summary"]["summary"] and again["initialInvestment"] == sc["summary"]["initialInvestment"]

    def test_model_inputs_trace_to_observations_or_labelled_assumptions(self, conn, factory):
        r = factory.run_document()
        params = conn.execute("select fp.*, (select count(*) from intel.financial_parameter_sources s where s.financial_parameter_id = fp.id) as sources from intel.financial_parameters fp where business_variant_id = %s and is_current", (r["variant"]["id"],)).fetchall()
        assert params
        for p in params:
            if p["basis"] == "assumption":
                assert p["evidence_grade"] == "D" and p["rationale"] and p["sources"] == 0
            else:
                assert p["sources"] >= 1, p["parameter_key"]
        sc = one(conn, "select grade_profile, assumption_count from intel.financial_scenarios where business_variant_id = %s and scenario_key = 'base' and is_current", r["variant"]["id"])
        assert sc["assumption_count"] == sum(1 for p in params if p["basis"] == "assumption") > 0

    def test_hand_checked_inputs_reach_the_engine(self, conn, factory):
        r = factory.run_document()
        sc = one(conn, "select input, summary from intel.financial_scenarios where business_variant_id = %s and scenario_key = 'base' and is_current", r["variant"]["id"])
        m = sc["input"]["input"]
        # capex: 2 × 200000 + 1 × 100000 + 100000 misc = 600000
        assert sum(c["amount"] for c in m["capex"]) == 600000 and sc["summary"]["initialInvestment"]["capex"] == 600000
        driver = m["revenueStreams"][0]["driver"]
        assert driver == {"kind": "capacity_utilization", "capacityUnitsPerMonth": 10000, "utilization": 1.0, "unitPrice": 100}
        # raw material 30.00 of 60.00 lakh = 50% of revenue; packaging 3.00 = 5%; maintenance stated as 2%
        assert {v["key"]: v["value"] for v in m["revenueStreams"][0]["variableCosts"]} == {"raw_material_consumed": 50.0, "packaging": 5.0, "repair_and_maintenance": 2.0}
        assert {f["key"]: f["monthlyAmount"] for f in m["fixedCosts"]} == {"rent": 20000, "selling_and_administrative_expenses": 10000, "electricity_bill": 10000}
        assert m["rampUp"] == {"startPct": 50.0, "monthsToSteadyState": 48}  # 50% in year 1 → 100% in year 5
        assert m["workingCapital"] == {"inventoryDays": 15, "receivableDays": 20, "payableDays": 10}
        assert m["financing"]["loan"] == {"principal": 300000, "annualInterestPct": 10, "tenureMonths": 60, "moratoriumMonths": 6}
        assert "subsidy" not in m["financing"]  # the source's subsidy is not modelled until verified
        rec = sc["summary"]["sourceReconciliation"]
        assert rec["statedRevenue"] == 6000000 and rec["modelledRevenue"] == 6000000 and rec["revenueDeltaPct"] == 0


class TestDerivations:
    def test_variable_cost_ratio_uses_production_value_not_net_sales(self, conn, factory):
        """Regression: sources state sales net of finished-goods stock build-up. Dividing a production cost by net
        sales overstated raw-material cost enough to turn a thin-margin business into a loss."""
        from .fixtures import SYNTHETIC_DPR_PAGES

        pages = [(no, text.replace("Total                            60.00      72.00", "Total                            54.00      72.00")
                              .replace("Synthetic Test Powder            60.00", "Synthetic Test Powder            54.00"))
                 for no, text in SYNTHETIC_DPR_PAGES]
        source, model = factory.source(), factory.model()
        doc = factory.document(source, pages=pages)
        run = enqueue(conn, "document_research", business_model_id=model["id"], source_document_id=doc["id"], idempotency_key=f"t:{uuid.uuid4()}")
        worker = Worker(conn, factory.settings, store=LocalEvidenceStore(factory.settings.evidence_dir))
        assert worker.execute(factory._claim(worker, run["id"]))["status"] == "succeeded"
        p = one(conn, """select fp.value, fp.basis, fp.rationale,
                                (select count(*) from intel.financial_parameter_sources s where s.financial_parameter_id = fp.id) as sources
                         from intel.financial_parameters fp join intel.cost_items ci on ci.id = fp.cost_item_id
                         join intel.business_variants v on v.id = ci.business_variant_id
                         where v.business_model_id = %s and ci.key = 'raw_material_consumed' and fp.is_current""", model["id"])
        # 30.00 lakh of raw material on production worth 120,000 × 50 % × ₹100 = 60 lakh → 50 %, not 30 / 54 = 55.6 %
        assert float(p["value"]) == 50.0 and p["basis"] == "derived" and "production value" in p["rationale"]
        assert p["sources"] == 4  # the cost line plus capacity, utilisation and price
        sc = one(conn, """select summary from intel.financial_scenarios fs join intel.business_variants v on v.id = fs.business_variant_id
                          where v.business_model_id = %s and fs.kind = 'base' and fs.is_current""", model["id"])
        rec = sc["summary"]["sourceReconciliation"]
        assert rec["statedRevenue"] == 5400000 and rec["modelledRevenue"] == 6000000  # the gap is the stock build-up, visible


class TestLocationOverlays:
    """National record + location-specific overlays, with the level of every local figure recorded."""

    def _metric(self, conn, factory, slug, value, segment="synthetic high street"):
        source = factory.source()
        return conn.execute(
            """insert into intel.location_metrics (location_id, metric_key, segment, value, unit_code, period, observed_on, geographic_scope,
                                                   source_id, evidence_type, evidence_grade, data_origin)
               select l.id, 'commercial_rent_per_sqft_month', %s, %s, 'inr', 'per_month', current_date,
                      case l.location_type when 'city' then 'city' else 'district' end, %s, 'listing_observation', 'C', 'test'
               from intel.locations l where l.slug = %s returning id""", (segment, value, source["id"], slug)).fetchone()["id"]

    def _rent(self, conn, variant_id, location_slug):
        return one(conn, """select fp.value, fp.basis, fp.location_level, fp.rationale, fp.evidence_grade
                            from intel.financial_parameters fp join intel.cost_items ci on ci.id = fp.cost_item_id
                            join intel.locations l on l.id = fp.location_id
                            where ci.business_variant_id = %s and ci.key = 'rent' and fp.is_current and l.slug = %s""", variant_id, location_slug)

    def _scenario(self, conn, variant_id, location_slug):
        return one(conn, """select fs.summary, fs.label, fs.input from intel.financial_scenarios fs join intel.locations l on l.id = fs.location_id
                            where fs.business_variant_id = %s and fs.is_current and l.slug = %s""", variant_id, location_slug)

    def test_city_figure_district_fallback_and_no_evidence(self, conn, factory):
        r = factory.run_document()
        vid = r["variant"]["id"]
        segment = f"synthetic {uuid.uuid4().hex[:8]}"  # isolates this test's metrics from any other test's
        # no mapping and no local evidence → no location scenario at all, and the run says why
        locations = r["run"]["result"]["build_model"]["variants"][0]["locations"]
        assert {x["location"]: x["scenario"] for x in locations} == {"Pune (city)": False, "Nanded-Waghala (city)": False}
        assert one(conn, "select count(*) as n from intel.financial_scenarios where business_variant_id = %s and location_id is not null", vid)["n"] == 0

        # the analyst ties the rent line to the local commercial rent × 1,200 sq ft, and records where 1,200 comes from
        conn.execute("""update intel.cost_items set location_metric_key = 'commercial_rent_per_sqft_month', location_metric_segment = %s,
                               location_metric_multiplier = 1200, location_metric_basis = 'synthetic: 1,200 sq ft assumed for the fixture'
                        where business_variant_id = %s and key = 'rent'""", (segment, vid))
        self._metric(conn, factory, "pune-city", 80, segment)         # a city-specific figure for Pune
        self._metric(conn, factory, "nanded-district", 25, segment)   # only a district figure for Nanded
        conn.commit()
        final = factory.refresh(r["model"]["id"])
        assert final["status"] == "succeeded", final["error"]

        pune = self._rent(conn, vid, "pune-city")
        assert float(pune["value"]) == 96000 and pune["location_level"] == "city" and pune["basis"] == "derived" and pune["evidence_grade"] == "C"
        nanded = self._rent(conn, vid, "nanded-city")
        assert float(nanded["value"]) == 30000 and nanded["location_level"] == "district"
        assert "inherited from Nanded district" in nanded["rationale"]

        # the national value is untouched, and each city scenario uses its own rent
        national = one(conn, """select fp.value from intel.financial_parameters fp join intel.cost_items ci on ci.id = fp.cost_item_id
                                where ci.business_variant_id = %s and ci.key = 'rent' and fp.is_current and fp.location_id is null""", vid)
        assert float(national["value"]) == 20000
        for slug, rent, level in (("pune-city", 96000, "city"), ("nanded-city", 30000, "district")):
            sc = self._scenario(conn, vid, slug)
            rent_line = next(f for f in sc["input"]["input"]["fixedCosts"] if f["key"] == "rent")
            assert rent_line["monthlyAmount"] == rent
            cov = sc["summary"]["locationCoverage"]
            assert cov["local_inputs"] == 1 and cov["by_level"] == {level: 1} and cov["inherited_national_inputs"] == cov["national_inputs_total"] - 1
            assert "remaining" in sc["summary"]["description"]
        base = one(conn, "select input from intel.financial_scenarios where business_variant_id = %s and is_current and kind = 'base' and location_id is null", vid)
        assert next(f for f in base["input"]["input"]["fixedCosts"] if f["key"] == "rent")["monthlyAmount"] == 20000
        checks = {c["check_key"]: c["is_satisfied"] for c in conn.execute("select check_key, is_satisfied from intel.v_completeness_items where business_model_id = %s", (r["model"]["id"],))}
        assert checks["geography.overlay"] is True

        # when the local evidence is rejected the overlay is retired and the city scenario disappears
        conn.execute("update intel.location_metrics set verification_status = 'rejected' where segment = %s", (segment,))
        conn.commit()
        factory.refresh(r["model"]["id"])
        assert self._rent(conn, vid, "pune-city") is None and self._scenario(conn, vid, "pune-city") is None
        assert one(conn, "select count(*) as n from intel.financial_parameters where business_variant_id = %s and location_id is not null and not is_current", vid)["n"] == 2

    def test_observation_recorded_for_a_place_beats_a_derived_local_rate(self, conn, factory):
        r = factory.run_document()
        vid = r["variant"]["id"]
        item = one(conn, "select id from intel.cost_items where business_variant_id = %s and key = 'synthetic_grinder'", vid)
        pune = one(conn, "select id from intel.locations where slug = 'pune-city'")["id"]
        conn.execute(
            """insert into intel.cost_observations (cost_item_id, value, unit_code, period, observed_on, source_id, location_id, geographic_scope,
                                                    evidence_type, evidence_grade, data_origin)
               values (%s, 210000, 'inr', 'one_time', current_date, %s, %s, 'city', 'manufacturer_catalogue', 'C', 'test')""",
            (item["id"], factory.source()["id"], pune))
        conn.commit()
        factory.refresh(r["model"]["id"])
        local = one(conn, "select value, location_level, basis from intel.financial_parameters where cost_item_id = %s and is_current and location_id = %s", item["id"], pune)
        assert float(local["value"]) == 210000 and local["location_level"] == "city" and local["basis"] == "observation"
        sc = self._scenario(conn, vid, "pune-city")
        assert next(c for c in sc["input"]["input"]["capex"] if c["key"] == "synthetic_grinder")["amount"] == 420000  # 2 × 210,000


# ── AC: missing data is visible / research tasks can be generated ────────────
class TestGaps:
    def test_missing_required_input_blocks_the_scenario_and_raises_a_task(self, conn, factory):
        r = factory.run_document()
        price = one(conn, "select id from intel.parameter_observations where business_variant_id = %s and parameter_key = 'unit_price'", r["variant"]["id"])
        conn.execute("update intel.parameter_observations set verification_status = 'rejected' where id = %s", (price["id"],))
        conn.commit()
        final = factory.refresh(r["model"]["id"])
        assert final["status"] == "succeeded"
        assert final["result"]["build_model"]["variants"][0]["missing_required"] == ["unit_price (Synthetic Test Powder)"]
        assert final["result"]["build_model"]["variants"][0]["parameters_retired"] >= 1  # the input lost its evidence and was retired
        # nothing was invented to fill the hole
        assert one(conn, "select count(*) as n from intel.financial_parameters where business_variant_id = %s and parameter_key = 'unit_price' and is_current", r["variant"]["id"])["n"] == 0
        assert one(conn, "select count(*) as n from intel.financial_scenarios where business_variant_id = %s and is_current", r["variant"]["id"])["n"] == 0
        status = one(conn, "select is_resolved from intel.v_variant_parameter_status where business_variant_id = %s and parameter_key = 'unit_price'", r["variant"]["id"])
        assert status["is_resolved"] is False
        checks = {c["check_key"]: c["is_satisfied"] for c in conn.execute("select check_key, is_satisfied from intel.v_completeness_items where business_model_id = %s", (r["model"]["id"],))}
        assert checks["financial.parameters"] is False and checks["financial.scenario"] is False and checks["capital.observed"] is True
        task = one(conn, "select * from intel.research_tasks where business_model_id = %s and generated_by = 'rule:required_parameter_missing' and status = 'open'", r["model"]["id"])
        assert task and task["target_key"] == "unit_price" and task["requires_human"]

    def test_gap_analysis_is_idempotent_and_closes_tasks_when_gaps_disappear(self, conn, factory):
        r = factory.run_document()
        n = one(conn, "select count(*) as n from intel.research_tasks where business_model_id = %s", r["model"]["id"])["n"]
        factory.refresh(r["model"]["id"])
        assert one(conn, "select count(*) as n from intel.research_tasks where business_model_id = %s", r["model"]["id"])["n"] == n
        conn.execute("insert into intel.business_risks (business_model_id, risk_type, title, description, data_origin) select %s, t, 'Synthetic ' || t, 'Synthetic', 'test' from unnest(array['capital_loss', 'operational', 'market']) t", (r["model"]["id"],))
        conn.commit()
        factory.refresh(r["model"]["id"])
        task = one(conn, "select status, resolution_note from intel.research_tasks where business_model_id = %s and generated_by = 'completeness:risk.register'", r["model"]["id"])
        assert task["status"] == "auto_closed" and "no longer exists" in task["resolution_note"]

    def test_completeness_and_evidence_quality_are_reported_separately(self, conn, factory):
        r = factory.run_document()
        c = one(conn, "select * from intel.v_business_completeness where business_model_id = %s", r["model"]["id"])
        q = one(conn, "select * from intel.v_business_evidence_quality where business_model_id = %s", r["model"]["id"])
        assert 0 < float(c["completeness_pct"]) < 100 and "ground_truth.interviews" in c["missing_checks"]
        assert q["grade_c"] > 0 and q["grade_a"] == 0 and q["verified_count"] == 0 and q["assumption_count"] > 0
        assert set(q["section_profiles"]) >= {"capex", "revenue_and_operations"}

    def test_stale_evidence_is_flagged_for_revalidation(self, conn, factory):
        r = factory.run_document(date="2019-01-01")  # old document, default 10-year window in the fixture source → shorten it
        conn.execute("update intel.cost_observations set revalidate_by = current_date - 30 where source_document_id = %s", (r["doc"]["id"],))
        conn.commit()
        factory.refresh(r["model"]["id"])
        q = one(conn, "select stale_count from intel.v_business_evidence_quality where business_model_id = %s", r["model"]["id"])
        assert q["stale_count"] == 11
        assert one(conn, "select count(*) as n from intel.research_tasks where business_model_id = %s and task_type = 'revalidate_evidence' and status = 'open'", r["model"]["id"])["n"] == 1


# ── AC: research jobs can resume after failure ───────────────────────────────
class TestDurability:
    def test_failed_stage_is_retried_and_completed_stages_are_not_rerun(self, conn, factory, settings, monkeypatch):
        from planb_research import pipeline
        from planb_research.pipeline import analysis

        calls = {"extract": 0, "build": 0}
        real_extract, real_build = stages.extract_claims, analysis.build_model

        def counting_extract(ctx):
            calls["extract"] += 1
            return real_extract(ctx)

        def flaky_build(ctx):
            calls["build"] += 1
            if calls["build"] == 1:
                raise RuntimeError("simulated crash in build_model")
            return real_build(ctx)

        patched = [(n, counting_extract if n == "extract_claims" else flaky_build if n == "build_model" else f) for n, f in pipeline.PIPELINES["document_research"]]
        monkeypatch.setitem(pipeline.PIPELINES, "document_research", patched)

        r = factory.run_document()
        assert r["run"]["status"] == "waiting_retry" and "simulated crash" in r["run"]["error"]
        assert r["run"]["next_attempt_at"] > r["run"]["created_at"]  # backoff scheduled
        steps = {s["stage"]: s for s in conn.execute("select * from ops.research_run_steps where run_id = %s", (r["run"]["id"],))}
        assert steps["cross_verify"]["status"] == "succeeded" and steps["build_model"]["status"] == "failed"

        final = r["worker"].execute(factory._claim(r["worker"], r["run"]["id"]))
        assert final["status"] == "succeeded" and final["attempt"] == 2
        assert calls == {"extract": 1, "build": 2}  # extraction was NOT repeated
        steps = {s["stage"]: s for s in conn.execute("select * from ops.research_run_steps where run_id = %s", (r["run"]["id"],))}
        assert steps["extract_claims"]["attempt"] == 1 and steps["build_model"]["attempt"] == 2
        assert one(conn, "select count(*) as n from intel.business_versions where business_model_id = %s", r["model"]["id"])["n"] == 1
        logs = [row["message"] for row in conn.execute("select message from ops.research_run_logs where run_id = %s order by id", (r["run"]["id"],))]
        assert any("skipped on resume" in m for m in logs)

    def test_run_abandoned_by_a_dead_worker_is_reclaimed(self, conn, factory, settings):
        model = factory.model()
        run = enqueue(conn, "business_refresh", business_model_id=model["id"], data_origin="test", idempotency_key=f"t:{uuid.uuid4()}")
        dead = Worker(conn, settings, worker_id="dead-worker", lease_seconds=60)
        assert dead.claim()["id"] == run["id"]
        alive = Worker(conn, settings, worker_id="alive-worker")
        assert alive.claim() is None  # lease still held
        conn.execute("update ops.research_runs set locked_until = now() - interval '1 second' where id = %s", (run["id"],))
        conn.commit()
        reclaimed = alive.claim()
        assert reclaimed["id"] == run["id"] and reclaimed["locked_by"] == "alive-worker" and reclaimed["attempt"] == 2

    def test_non_retryable_failure_stops_immediately(self, conn, factory, monkeypatch):
        from planb_research import pipeline

        def refuse(ctx):
            raise NonRetryableError("no extractor available")

        patched = [(n, refuse if n == "extract_claims" else f) for n, f in pipeline.PIPELINES["document_research"]]
        monkeypatch.setitem(pipeline.PIPELINES, "document_research", patched)
        r = factory.run_document()
        assert r["run"]["status"] == "failed" and r["run"]["finished_at"] is not None

    def test_attempts_are_bounded(self, conn, factory, settings, monkeypatch):
        from planb_research import pipeline

        def boom(ctx):
            raise RuntimeError("always fails")

        monkeypatch.setitem(pipeline.PIPELINES, "business_refresh", [("normalize_claims", boom)])
        model = factory.model()
        run = enqueue(conn, "business_refresh", business_model_id=model["id"], data_origin="test", max_attempts=2, idempotency_key=f"t:{uuid.uuid4()}")
        worker = Worker(conn, settings)
        assert worker.execute(factory._claim(worker, run["id"]))["status"] == "waiting_retry"
        assert worker.execute(factory._claim(worker, run["id"]))["status"] == "failed"

    def test_llm_budget_stops_the_run_before_overspending(self, conn, factory, monkeypatch):
        from planb_research import pipeline
        from planb_research.pipeline.runner import BudgetExceeded  # noqa: F401

        def spend(ctx):
            ctx.check_budget(next_call_estimate_usd=0.02)
            ctx.record_llm_usage(provider="test", model="fake", purpose="test", input_tokens=1000, output_tokens=500, cost_usd=0.04)
            ctx.check_budget(next_call_estimate_usd=0.02)  # 0.04 spent + 0.02 > 0.05 budget
            return {}

        monkeypatch.setitem(pipeline.PIPELINES, "business_refresh", [("normalize_claims", spend)])
        model = factory.model()
        run = enqueue(conn, "business_refresh", business_model_id=model["id"], data_origin="test", budget_usd=0.05, idempotency_key=f"t:{uuid.uuid4()}")
        worker = Worker(conn, factory.settings)
        final = worker.execute(factory._claim(worker, run["id"]))
        assert final["status"] == "budget_exhausted" and float(final["spent_usd"]) == 0.04
        assert one(conn, "select count(*) as n from ops.llm_usage where run_id = %s", run["id"])["n"] == 1


# ── AC: analysts can review and correct extracted information ────────────────
class TestReview:
    def test_reviewer_rejects_a_claim_and_its_observation_is_retired(self, conn, factory, settings):
        r = factory.run_document()
        claim = one(conn, "select id from intel.evidence_claims where source_document_id = %s and subject = 'Synthetic packer'", r["doc"]["id"])
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.review_claim(%s, 'reject', 'Wrong machine for this capacity')", (claim["id"],))
            c.commit()
        obs = one(conn, """select o.verification_status from intel.cost_observations o join intel.evidence_links l on l.target_id = o.id
                           where l.claim_id = %s and l.target_table = 'cost_observations'""", claim["id"])
        assert obs["verification_status"] == "rejected"
        review = one(conn, "select * from intel.research_reviews where subject_id = %s", claim["id"])
        assert review["decision"] == "reject" and review["reviewer"] == REVIEWER
        audit = one(conn, "select actor_user_id, actor_db_role, changed_fields from ops.audit_log where table_name = 'evidence_claims' and row_id = %s and action = 'UPDATE' order by id desc limit 1", str(claim["id"]))
        assert audit["actor_user_id"] == REVIEWER and audit["actor_db_role"] == "authenticated" and "status" in audit["changed_fields"]

    def test_refresh_after_rejecting_a_machinery_line_reports_the_broken_total(self, conn, factory, settings):
        """Regression: with a machinery line rejected, the lines no longer add up to the stated total. The
        cross-verification stage must report that and carry on, not fail."""
        r = factory.run_document()
        claim = one(conn, "select id from intel.evidence_claims where source_document_id = %s and subject = 'Synthetic packer'", r["doc"]["id"])
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.review_claim(%s, 'reject', 'Not part of this configuration')", (claim["id"],))
            c.commit()
        final = factory.refresh(r["model"]["id"])
        assert final["status"] == "succeeded", final["error"]
        assert final["result"]["cross_verify"]["consistency_mismatches"] == 1
        warning = one(conn, "select message, data from ops.research_run_logs where run_id = %s and level = 'warning' and stage = 'cross_verify'", final["id"])
        assert "do not add up" in warning["message"] and warning["data"] == {"lines_total": 400000.0, "stated_total": 500000.0}
        capex = one(conn, "select summary->'initialInvestment'->>'capex' as capex from intel.financial_scenarios where business_variant_id = %s and kind = 'base' and is_current", r["variant"]["id"])
        assert float(capex["capex"]) == 500000  # 600000 less the rejected 100000 packer

    def test_rejection_requires_a_reason(self, conn, factory, settings):
        r = factory.run_document()
        claim = one(conn, "select id from intel.evidence_claims where source_document_id = %s limit 1", r["doc"]["id"])
        with as_user(settings, REVIEWER) as c, pytest.raises(psycopg.errors.CheckViolation, match="requires a reason"):
            c.execute("select intel.review_claim(%s, 'reject', '')", (claim["id"],))

    def test_correction_supersedes_the_extraction_and_flows_into_the_model(self, conn, factory, settings):
        r = factory.run_document()
        claim = one(conn, "select id from intel.evidence_claims where source_document_id = %s and subject = 'Rent'", r["doc"]["id"])
        with as_user(settings, REVIEWER) as c:
            # the analyst decides the row should be read from a different line of the same page
            new = c.execute("select (x).id, (x).status, (x).quote_verified from (select intel.correct_claim(%s, 1.20, 'Rs. in lacs', 'selling & adm exp 1.20 1.20 1.20 1.20 1.20', 7, 'Rent line misread; use 1.20') as x) y", (claim["id"],)).fetchone()
            c.commit()
        assert new["status"] == "accepted" and new["quote_verified"]
        assert one(conn, "select status from intel.evidence_claims where id = %s", claim["id"])["status"] == "superseded"
        assert factory.refresh(r["model"]["id"])["status"] == "succeeded"
        param = one(conn, """select fp.value from intel.financial_parameters fp join intel.cost_items ci on ci.id = fp.cost_item_id
                             where ci.business_variant_id = %s and ci.key = 'rent' and fp.is_current""", r["variant"]["id"])
        assert float(param["value"]) == 10000  # 1.20 lakh a year → 10,000 a month (was 20,000)
        history = conn.execute("""select o.value, o.verification_status from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id
                                  where ci.business_variant_id = %s and ci.key = 'rent' order by o.created_at""", (r["variant"]["id"],)).fetchall()
        assert [(float(h["value"]), h["verification_status"]) for h in history] == [(240000, "rejected"), (120000, "unverified")]

    def test_correction_with_a_quote_that_is_not_on_the_page_stays_unaccepted(self, conn, factory, settings):
        r = factory.run_document()
        claim = one(conn, "select id from intel.evidence_claims where source_document_id = %s and subject = 'Rent'", r["doc"]["id"])
        with as_user(settings, REVIEWER) as c:
            new = c.execute("select (x).status, (x).quote_verified from (select intel.correct_claim(%s, 9.99, 'Rs. in lacs', 'Rent 9.99', 7, 'typo') as x) y", (claim["id"],)).fetchone()
        assert new["status"] == "extracted" and new["quote_verified"] is False

    def test_analyst_assumption_is_recorded_and_not_overwritten_by_the_pipeline(self, conn, factory, settings):
        r = factory.run_document()
        with as_user(settings, RESEARCHER) as c:
            c.execute("select intel.set_assumption(%s, 'owner_monthly_compensation', null, 40000, 'Owner needs to replace a salary of Rs 40,000')", (r["variant"]["id"],))
            c.commit()
        factory.refresh(r["model"]["id"])
        p = one(conn, "select * from intel.financial_parameters where business_variant_id = %s and parameter_key = 'owner_monthly_compensation' and is_current", r["variant"]["id"])
        assert float(p["value"]) == 40000 and p["basis"] == "assumption" and p["evidence_grade"] == "D" and p["set_by"] == RESEARCHER
        sc = one(conn, "select input from intel.financial_scenarios where business_variant_id = %s and scenario_key = 'base' and is_current", r["variant"]["id"])
        assert sc["input"]["input"]["owner"]["monthlyCompensation"] == 40000


# ── AC: unapproved models cannot be published · approved records keep version history ──
class TestPublication:
    def _publishable(self, conn, factory, settings):
        """A research-origin record with every claim reviewed, and a policy relaxed to what one document can satisfy."""
        r = factory.run_document(origin="research")
        with as_user(settings, REVIEWER) as c:
            for row in conn.execute("select id from intel.evidence_claims where business_model_id = %s and status = 'extracted'", (r["model"]["id"],)).fetchall():
                c.execute("select intel.review_claim(%s, 'accept', null)", (row["id"],))
            c.commit()
        conn.execute("update ops.publication_policy set min_completeness_pct = 30, max_critical_missing = 5")
        conn.commit()
        return r

    def _version(self, conn, model_id):
        return one(conn, "select * from intel.business_versions where business_model_id = %s order by version_no desc limit 1", model_id)

    def test_submitted_version_cannot_be_published_by_any_path(self, conn, factory, settings):
        r = factory.run_document(origin="research")
        v = self._version(conn, r["model"]["id"])
        with as_user(settings, ADMIN) as c, pytest.raises(psycopg.errors.RaiseException, match="not approved by a reviewer"):
            c.execute("select pub.publish_business_version(%s)", (v["id"],))
        with pytest.raises(psycopg.errors.RaiseException, match="cannot publish"):  # even a direct insert by the table owner
            conn.execute("""insert into pub.publication_versions (business_model_id, business_version_id, publication_no, slug, name, snapshot, completeness_pct, evidence_profile, policy_applied)
                            values (%s, %s, 1, 'x', 'x', '{}', 100, '{}', '{}')""", (r["model"]["id"], v["id"]))
        conn.rollback()
        assert one(conn, "select count(*) as n from pub.publication_versions where business_model_id = %s", r["model"]["id"])["n"] == 0

    def test_incomplete_record_is_blocked_with_explicit_reasons(self, conn, factory, settings):
        conn.execute("update ops.publication_policy set min_completeness_pct = 75, max_critical_missing = 0")
        conn.commit()
        r = factory.run_document(origin="research")
        v = self._version(conn, r["model"]["id"])
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.decide_business_version(%s, 'approve', 'Extraction is faithful to the document')", (v["id"],))
            c.commit()
        blockers = one(conn, "select pub.publication_blockers(%s) as b", v["id"])["b"]
        text = " | ".join(blockers)
        assert "completeness" in text and "critical sections missing" in text and "awaiting review" in text
        with as_user(settings, ADMIN) as c, pytest.raises(psycopg.errors.RaiseException, match="cannot publish"):
            c.execute("select pub.publish_business_version(%s)", (v["id"],))

    def test_four_eyes_and_role_rules_on_approval(self, conn, factory, settings):
        model = factory.model(origin="research")
        with as_user(settings, RESEARCHER) as c:
            v = c.execute("select (x).id from (select intel.submit_business_version(%s, 'manual submission') as x) y", (model["id"],)).fetchone()
            c.commit()
            # a researcher cannot decide: the row is not updatable for them under RLS
            with pytest.raises(psycopg.errors.NoDataFound):
                c.execute("select intel.decide_business_version(%s, 'approve', null)", (v["id"],))
            c.rollback()
        # an admin who did not submit may approve; the submitter may not, whatever their role
        conn.execute("insert into ops.staff_roles (user_id, role) values (%s, 'reviewer') on conflict do nothing", (RESEARCHER,))
        conn.commit()
        try:
            with as_user(settings, RESEARCHER) as c, pytest.raises(psycopg.errors.RaiseException, match="four-eyes"):
                c.execute("select intel.decide_business_version(%s, 'approve', null)", (v["id"],))
        finally:
            conn.execute("delete from ops.staff_roles where user_id = %s and role = 'reviewer'", (RESEARCHER,))
            conn.commit()
        with as_user(settings, REVIEWER) as c:
            with pytest.raises(psycopg.errors.CheckViolation, match="requires comments"):
                c.execute("select intel.decide_business_version(%s, 'reject', null)", (v["id"],))
            c.rollback()
            c.execute("select intel.decide_business_version(%s, 'approve', null)", (v["id"],))
            c.commit()
        assert self._version(conn, model["id"])["decided_by"] == REVIEWER

    def test_publish_then_republish_keeps_full_version_history(self, conn, factory, settings):
        r = self._publishable(conn, factory, settings)
        model_id = r["model"]["id"]
        v1 = self._version(conn, model_id)
        # v1 was submitted before the claims were reviewed → it records 28+ pending claims and cannot be published
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.decide_business_version(%s, 'request_changes', 'Review the extracted claims first')", (v1["id"],))
            c.commit()
        assert one(conn, "select lifecycle_status from intel.business_models where id = %s", model_id)["lifecycle_status"] == "researching"

        factory.refresh(model_id)
        with as_user(settings, RESEARCHER) as c:
            c.execute("select intel.submit_business_version(%s, 'All claims reviewed')", (model_id,))
            c.commit()
        v2 = self._version(conn, model_id)
        assert v2["version_no"] == 2 and v2["pending_claims"] == 0 and v2["non_research_rows"] == 0 and v2["restricted_source_rows"] == 0
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.decide_business_version(%s, 'approve', 'ok')", (v2["id"],))
            c.commit()
        assert one(conn, "select pub.publication_blockers(%s) as b", v2["id"])["b"] == []
        with as_user(settings, REVIEWER) as c, pytest.raises(psycopg.errors.InsufficientPrivilege):  # publishing is an admin act
            c.execute("select pub.publish_business_version(%s)", (v2["id"],))
        with as_user(settings, ADMIN) as c:
            c.execute("select pub.publish_business_version(%s)", (v2["id"],))
            c.commit()
        p1 = one(conn, "select * from pub.publication_versions where business_model_id = %s", model_id)
        assert p1["status"] == "live" and p1["publication_no"] == 1 and p1["published_by"] == ADMIN and p1["snapshot"] == v2["snapshot"]
        assert one(conn, "select lifecycle_status from intel.business_models where id = %s", model_id)["lifecycle_status"] == "published"

        # a third version supersedes; nothing is rewritten
        with as_user(settings, RESEARCHER) as c:
            c.execute("select intel.set_assumption(%s, 'owner_monthly_compensation', null, 25000, 'Owner draw added')", (r["variant"]["id"],))
            c.commit()
        factory.refresh(model_id)
        with as_user(settings, RESEARCHER) as c:
            c.execute("select intel.submit_business_version(%s, 'Owner draw added')", (model_id,))
            c.commit()
        v3 = self._version(conn, model_id)
        with as_user(settings, REVIEWER) as c:
            c.execute("select intel.decide_business_version(%s, 'approve', 'ok')", (v3["id"],))
            c.commit()
        with as_user(settings, ADMIN) as c:
            c.execute("select pub.publish_business_version(%s)", (v3["id"],))
            c.commit()
        versions = conn.execute("select version_no, status from intel.business_versions where business_model_id = %s order by version_no", (model_id,)).fetchall()
        assert [(v["version_no"], v["status"]) for v in versions] == [(1, "changes_requested"), (2, "superseded"), (3, "approved")]
        pubs = conn.execute("select publication_no, status from pub.publication_versions where business_model_id = %s order by publication_no", (model_id,)).fetchall()
        assert [(p["publication_no"], p["status"]) for p in pubs] == [(1, "superseded"), (2, "live")]
        assert v2["snapshot"] != v3["snapshot"] and self._version(conn, model_id)["snapshot_hash"] == v3["snapshot_hash"]
        # versions and publications are immutable
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            conn.execute("update intel.business_versions set snapshot = '{}' where id = %s", (v2["id"],))
        conn.rollback()
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            conn.execute("update pub.publication_versions set snapshot = '{}' where id = %s", (p1["id"],))
        conn.rollback()
        # customers see only the teaser of the live publication
        with as_user(settings, None, role="anon") as c:
            rows = c.execute("select slug, publication_no from pub.catalog where business_model_id = %s", (model_id,)).fetchall()
            assert [(row["slug"], row["publication_no"]) for row in rows] == [(r["model"]["slug"], 2)]

    def test_source_without_reuse_rights_blocks_publication(self, conn, factory, settings):
        r = factory.run_document(origin="research", reuse_status="permission_required")
        v = self._version(conn, r["model"]["id"])
        assert v["restricted_source_rows"] > 0
        assert any("reuse terms" in b for b in one(conn, "select pub.publication_blockers(%s) as b", v["id"])["b"])


# ── AC: demonstration data cannot be mistaken for verified research ──────────
class TestDemoData:
    def test_demo_observation_cannot_be_graded_or_verified(self, conn, factory):
        r = factory.run_document()
        item = one(conn, "select id from intel.cost_items where business_variant_id = %s limit 1", r["variant"]["id"])
        base = "insert into intel.cost_observations (cost_item_id, value, unit_code, period, observed_on, source_id, evidence_type, evidence_grade, verification_status, verified_by, data_origin) values (%s, 1, 'inr', 'one_time', current_date, %s, 'supplier_quote', %s, %s, %s, 'demo')"
        for grade, status in (("C", "unverified"), ("D", "verified")):
            with pytest.raises(psycopg.errors.CheckViolation, match="demo data"):
                conn.execute(base, (item["id"], r["source"]["id"], grade, status, ADMIN))
            conn.rollback()
        conn.execute(base, (item["id"], r["source"]["id"], "D", "unverified", None))  # allowed only as grade D, unverified
        conn.commit()

    def test_estimates_are_always_grade_d(self, conn, factory):
        r = factory.run_document()
        item = one(conn, "select id from intel.cost_items where business_variant_id = %s limit 1", r["variant"]["id"])
        for etype in ("llm_estimate", "analyst_estimate"):
            with pytest.raises(psycopg.errors.CheckViolation, match="grade D"):
                conn.execute("insert into intel.cost_observations (cost_item_id, value, unit_code, period, observed_on, source_id, evidence_type, evidence_grade, data_origin) values (%s, 1, 'inr', 'one_time', current_date, %s, %s, 'B', 'test')", (item["id"], r["source"]["id"], etype))
            conn.rollback()

    def test_grade_a_requires_verified_primary_evidence(self, conn, factory):
        r = factory.run_document()
        obs = one(conn, "select o.id from intel.cost_observations o join intel.cost_items ci on ci.id = o.cost_item_id where ci.business_variant_id = %s limit 1", r["variant"]["id"])
        with pytest.raises(psycopg.errors.CheckViolation, match="grade A requires"):
            conn.execute("update intel.cost_observations set evidence_grade = 'A' where id = %s", (obs["id"],))
        conn.rollback()

    def test_demo_or_test_records_can_never_be_published(self, conn, factory, settings):
        conn.execute("update ops.publication_policy set min_completeness_pct = 0, max_critical_missing = 99, max_pending_claims = 999, min_parameters_c_or_better_pct = 0")
        conn.commit()
        try:
            for origin in ("demo", "test"):
                r = factory.run_document(origin=origin)
                v = one(conn, "select * from intel.business_versions where business_model_id = %s", r["model"]["id"])
                assert v["non_research_rows"] > 0
                with as_user(settings, REVIEWER) as c:
                    c.execute("select intel.decide_business_version(%s, 'approve', 'ok')", (v["id"],))
                    c.commit()
                blockers = one(conn, "select pub.publication_blockers(%s) as b", v["id"])["b"]
                assert any(f"{origin} data, not research" in b for b in blockers) and any("demo/test rows" in b for b in blockers)
                with as_user(settings, ADMIN) as c, pytest.raises(psycopg.errors.RaiseException, match="cannot publish"):
                    c.execute("select pub.publish_business_version(%s)", (v["id"],))
        finally:
            conn.execute("update ops.publication_policy set min_completeness_pct = 75, max_critical_missing = 0, max_pending_claims = 0, min_parameters_c_or_better_pct = 70")
            conn.commit()
