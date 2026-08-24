import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const storage = new Map([
  ['tccSubscriptionsV1', JSON.stringify({ selected: [] })],
]);
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { style: {}, appendChild() {}, querySelectorAll() { return []; } }; },
  head: { appendChild() {} },
};
const window = { TCC_TARIFF_OVERLAY_V1: { subscriptions: [] } };
const context = vm.createContext({
  window,
  document,
  localStorage,
  console,
  Intl,
  Date,
  Promise,
  MutationObserver: class { observe() {} },
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
});

vm.runInContext(fs.readFileSync('assets/v8-subscription-selection.js', 'utf8'), context, {
  filename: 'assets/v8-subscription-selection.js',
});

const subscriptions = window.TCCV8Subscriptions;
assert.equal(subscriptions.subscriptionIdForProvider('Belib’ direct — Abonné résident Paris'), 'belib-resident');
assert.equal(subscriptions.subscriptionIdForProvider('Belib’ direct — Abonné résident'), 'belib-resident');
assert.equal(subscriptions.subscriptionIdForProvider('Belib’ direct — Abonné non-résident'), 'belib-nonresident');
assert.equal(subscriptions.subscriptionIdForProvider('Belib’ direct — Visiteur'), '');

const resident = { offerProvider: 'Electroverse', configurationLabel: 'Belib’ direct — Abonné résident Paris · AC 7 kW' };
const nonresident = { configurationLabel: 'Belib’ direct — Abonné non-résident · AC 7 kW' };
const visitor = { configurationLabel: 'Belib’ direct — Visiteur · AC 7 kW' };
assert.equal(subscriptions.isStationEligible(resident), false);
assert.equal(subscriptions.isStationEligible(nonresident), false);
assert.equal(subscriptions.isStationEligible(visitor), true);

vm.runInContext(fs.readFileSync('assets/v8-offer-selection.js', 'utf8'), context, {
  filename: 'assets/v8-offer-selection.js',
});

const offers = window.TCCV8OfferSelection;
const variant = (provider, total) => ({
  st: {
    id: `belib:test::${provider}`,
    catalogStationId: 'belib:test',
    kind: 'AC',
    powerKw: 7,
    configurationLabel: `${provider} · AC 7 kW`,
  },
  r: { total, unavailable: false, unknown: false },
  distanceKm: 1,
});
const variants = [
  variant('Belib’ direct — Abonné résident Paris', 5),
  variant('Belib’ direct — Abonné non-résident', 6),
  variant('Belib’ direct — Visiteur', 10),
];

let collapsed = offers.collapseOfferVariants(variants);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0].r.total, 10, 'Sans abonnement, le tarif Visiteur doit déterminer le classement.');
assert.equal(collapsed[0].st._offerComparison.offers.length, 3, 'Les offres abonnées restent affichables.');

storage.set('tccSubscriptionsV1', JSON.stringify({ selected: ['belib-resident'] }));
collapsed = offers.collapseOfferVariants(variants);
assert.equal(collapsed[0].r.total, 5, 'Le tarif résident doit être classable après sélection.');

storage.set('tccSubscriptionsV1', JSON.stringify({ selected: ['belib-nonresident'] }));
collapsed = offers.collapseOfferVariants(variants);
assert.equal(collapsed[0].r.total, 6, 'Le tarif non-résident doit être classable après sélection.');

storage.set('tccSubscriptionsV1', JSON.stringify({ selected: ['electra-smart'] }));
collapsed = offers.collapseOfferVariants(variants);
assert.equal(collapsed[0].r.total, 10, 'Un autre abonnement ne doit pas activer Belib’.');

const august = fs.readFileSync('assets/august-release.js', 'utf8');
assert.match(august, /available\.filter\(x=>rankingSubscriptionEligible\(x\.st\)\)/);
assert.match(august, /const topPhysical=\[\.\.\.new Set\(eligible\.map\(physicalResultKey\)\)\]\.slice\(0,20\)/);
assert.doesNotMatch(august, /return available\.slice\(0,20\)/);

const resolver = fs.readFileSync('assets/v8-direct-resolver-ui.js', 'utf8');
assert.match(resolver, /TCCV8Subscriptions\?\.selectionChanged/);

const integrity = fs.readFileSync('assets/v8-source-integrity.js', 'utf8');
assert.match(integrity, /\(!m\.subscriptionId\|\|selected\.has\(m\.subscriptionId\)\)/);
assert.match(integrity, /subscriptionIdForProvider\(provider\)/);

console.log('Belib subscription ranking tests passed: resident and non-resident are opt-in before Top 20.');
