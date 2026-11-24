import { describe, expect, it } from 'vitest';
import { ARCHETYPES, DRIVER_KINDS, DriverSchema, priceParameterOf, volumeParameterOf } from '../src/index';

describe('ARCHETYPES metadata', () => {
  it('describes every driver kind exactly once, in schema order', () => {
    expect(ARCHETYPES.map((archetype) => archetype.key)).toEqual([...DRIVER_KINDS]);
  });

  it('required parameter keys are exactly the keys the schema requires for that driver', () => {
    for (const archetype of ARCHETYPES) {
      // build a driver from the metadata alone: it must validate
      const driver: Record<string, unknown> = { kind: archetype.key };
      for (const parameter of archetype.requiredParameters) {
        driver[parameter.key] = parameter.valueType === 'calendar_months' ? [1] : parameter.valueType === 'fraction_0_1' ? 0.5 : 1;
      }
      expect(DriverSchema.safeParse(driver).success, archetype.key).toBe(true);
      // removing any one parameter must fail validation -> the list has no optional extras
      for (const parameter of archetype.requiredParameters) {
        const incomplete = { ...driver };
        delete incomplete[parameter.key];
        expect(DriverSchema.safeParse(incomplete).success, `${archetype.key} without ${parameter.key}`).toBe(false);
      }
      // fractions above 1 are rejected for ratio parameters
      for (const parameter of archetype.requiredParameters.filter((p) => p.valueType === 'fraction_0_1')) {
        expect(DriverSchema.safeParse({ ...driver, [parameter.key]: 1.5 }).success).toBe(false);
        expect(parameter.max).toBe(1);
      }
    }
  });

  it('names the volume and price parameters used by scenario adjustments', () => {
    for (const archetype of ARCHETYPES) {
      const keys = archetype.requiredParameters.map((parameter) => parameter.key);
      expect(archetype.volumeParameter).toBe(volumeParameterOf(archetype.key).parameter);
      expect(archetype.priceParameter).toBe(priceParameterOf(archetype.key));
      expect(keys).toContain(archetype.volumeParameter);
      expect(keys).toContain(archetype.priceParameter);
      expect(archetype.capacityBound).toBe(volumeParameterOf(archetype.key).isRatio);
      expect(archetype.requiredParameters.find((p) => p.key === archetype.priceParameter)?.role).toBe('price');
    }
  });

  it('every entry is fully documented and JSON-serialisable', () => {
    for (const archetype of ARCHETYPES) {
      expect(archetype.label.length).toBeGreaterThan(5);
      expect(archetype.formula).toContain('revenue = units ×');
      expect(archetype.unitOfVolume.length).toBeGreaterThan(2);
      expect(archetype.typicalUses.length).toBeGreaterThan(0);
      for (const parameter of archetype.requiredParameters) {
        expect(parameter.unit.length).toBeGreaterThan(0);
        expect(parameter.label.length).toBeGreaterThan(0);
        expect(parameter.description.length).toBeGreaterThan(10);
      }
    }
    expect(JSON.parse(JSON.stringify(ARCHETYPES))).toEqual(ARCHETYPES);
  });
});
