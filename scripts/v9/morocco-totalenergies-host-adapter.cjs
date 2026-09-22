'use strict';

function adaptTotalEnergiesMorocco(officialInventory, alWahaAttribution, linkReconciliation) {
  if (!officialInventory || !Array.isArray(officialInventory.rows)) {
    throw new Error('invalid official TotalEnergies inventory');
  }

  const reconciliation = linkReconciliation && linkReconciliation.reconciliation || {};
  const correctedDuplicateLabel = String(reconciliation.corrected_second_tamesna_label || '').trim();
  const coordinateRows = Array.isArray(linkReconciliation && linkReconciliation.official_link_coordinates)
    ? linkReconciliation.official_link_coordinates : [];
  const coordinates = new Map(coordinateRows.map(x => [String(x.site_name || '').trim(), {
    latitude: Number(x.latitude), longitude: Number(x.longitude)
  }]));

  const hostSites = new Map();
  let tamesnaSeen = 0;
  for (const row of officialInventory.rows) {
    let name = String(row.site_name || '').trim();
    if (!name) continue;
    if (name === 'TAMESNA') {
      tamesnaSeen += 1;
      if (tamesnaSeen === 2 && correctedDuplicateLabel) name = correctedDuplicateLabel;
    }
    if (!hostSites.has(name)) hostSites.set(name, []);
    hostSites.get(name).push({
      chargerCount: Number(row.charger_count || 0),
      powerKW: Number(row.power_kw || 0),
      currentClass: row.current_class || null,
    });
  }

  const diagnostics = [...hostSites.entries()].map(([name, chargers]) => {
    const geo = coordinates.get(name);
    return {
      countryCode: 'MA',
      name,
      latitude: geo && Number.isFinite(geo.latitude) ? geo.latitude : null,
      longitude: geo && Number.isFinite(geo.longitude) ? geo.longitude : null,
      physicalOperator: null,
      networkBrand: null,
      access: {
        appSource: 'TotalEnergies official public website',
        accessNetwork: null,
        siteBrand: 'TotalEnergies',
      },
      status: { state: 'unknown', statusSource: null },
      offers: [],
      chargers,
      productionEligible: false,
      exclusionReason: 'missing_station_specific_cpo',
    };
  });

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
      geolocatedHostSites: diagnostics.filter(x => Number.isFinite(x.latitude) && Number.isFinite(x.longitude)).length,
      productionStationCount: production.length,
      hostCountReconciled: Number(reconciliation.corrected_unique_host_sites || 0) === hostSites.size,
    },
    production,
    diagnostics,
  };
}

module.exports = { adaptTotalEnergiesMorocco };
