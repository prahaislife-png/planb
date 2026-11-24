import type { Driver } from './schema';

/**
 * Every revenue driver reduces to `units per month × price per unit`.
 *
 * `volumeMultiplier` is ramp-up × seasonality for the month. Drivers that are bound
 * by a physical capacity (utilisation-type ratios) are capped at 100 % of capacity:
 * the effective ratio is min(1, ratio × volumeMultiplier).
 */
export interface DriverVolume {
  units: number;
  /** True when the capacity cap was binding (requested volume exceeded capacity). */
  capped: boolean;
}

const cappedRatio = (ratio: number, multiplier: number): { ratio: number; capped: boolean } => {
  const requested = ratio * multiplier;
  // tolerance so that e.g. 0.8 × 1.25 = 1.0000000000000002 is not reported as "capped"
  if (requested > 1 + 1e-12) return { ratio: 1, capped: true };
  return { ratio: Math.min(requested, 1), capped: false };
};

/** Units in one month for a non-agricultural driver, or units of ONE harvest cycle for `area_yield`. */
export function driverUnits(driver: Driver, volumeMultiplier: number): DriverVolume {
  switch (driver.kind) {
    case 'transactions':
      return {
        units: driver.transactionsPerDay * driver.operatingDaysPerMonth * volumeMultiplier,
        capped: false,
      };
    case 'capacity_utilization': {
      const r = cappedRatio(driver.utilization, volumeMultiplier);
      return { units: driver.capacityUnitsPerMonth * r.ratio, capped: r.capped };
    }
    case 'area_yield':
      return { units: driver.area * driver.yieldPerAreaPerCycle * volumeMultiplier, capped: false };
    case 'enrolment': {
      const r = cappedRatio(driver.enrolmentRate, volumeMultiplier);
      return { units: driver.capacityStudents * r.ratio, capped: r.capped };
    }
    case 'occupancy': {
      const r = cappedRatio(driver.occupancy, volumeMultiplier);
      return { units: driver.rentableArea * r.ratio, capped: r.capped };
    }
    case 'fleet_utilization': {
      const r = cappedRatio(driver.utilization, volumeMultiplier);
      return { units: driver.unitCount * driver.billableDaysPerMonth * r.ratio, capped: r.capped };
    }
    case 'engagements':
      return { units: driver.engagementsPerMonth * volumeMultiplier, capped: false };
  }
}

/** Base (un-escalated) price per unit of a driver. */
export function driverPrice(driver: Driver): number {
  switch (driver.kind) {
    case 'transactions':
      return driver.averageTicket;
    case 'capacity_utilization':
      return driver.unitPrice;
    case 'area_yield':
      return driver.pricePerUnit;
    case 'enrolment':
      return driver.feePerStudentPerMonth;
    case 'occupancy':
      return driver.ratePerAreaPerMonth;
    case 'fleet_utilization':
      return driver.ratePerUnitPerDay;
    case 'engagements':
      return driver.realizedFee;
  }
}
