'use strict';

function adaptTotalEnergiesMorocco(officialInventory, alWahaAttribution) {
  if (!officialInventory || !Array.isArray(officialInventory.rows)) {
    throw new Error('invalid official TotalEnergies inventory');
  }
  const hostSites = new Map();
  for (const row of officialInventory.rows) {
    const name = String(row.site_name || '').trim();
    if (!name) continue;
    if (!hostSites.has(name)) hostSites.set(name, []);
    hostSites.get(name).push({
      chargerCount: Number(row.charger_count || 0),
      powerKW: Number(row.power_kw || 0),
      currentClass: row.current_class || null,
    });
  }

  const diagnostics = [...hostSites.entries()].map(([name, chargers]) => ({
    countryCode: 'MA',
    name,
    siteBrand: 'TotalEnergies',
    physicalOperator: null,
    access: {
      appSource: 'TotalEnergies official public website',
      accessNetwork: null,
      siteBrand: 'TotalEnergies',
    },
    status: { state: 'unknown', statusSource: null },
    offers: [],
    chargers,
    productionEligible: false,
    exclusionReason: 'missing_station_specific_cpo_and_coordinates',
  }));

  const production = [];
  const s = alWahaAttribution && alWahaAttribution.station;
  if (s && s.operator_cpo === 'Kilowatt' && Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude))) {
    production.push({
      countryCode: 'MA',
      name: s.canonical_name || 'TotalEnergies AL WAHA',
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      physicalOperator: 'Kilowatt',
      networkBrand: 'Kilowatt',
      access: {
        siteBrand: 'TotalEnergies',
        appSource: 'Kilowatt public web map',
        accessNetwork: 'Kilowatt',
      },
      status: {
        state: 'available',
        statusSource: 'Kilowatt public web map',
      },
      evses: [{
        id: s.kilowatt_station_id || null,
        connectors: [{ type: 'Type 2', powerKW: Number(s.official_power_kw || 22) }],
      }],
      offers: [],
      tariffChannel: null,
      productionEligible: true,
    });
  }

  return {
    summary: {
      officialSourceRows: officialInventory.rows.length,
      uniqueHostSites: hostSites.size,
      productionStationCount: production.length,
    },
    production,
    diagnostics,
  };
}

module.exports = { adaptTotalEnergiesMorocco };
