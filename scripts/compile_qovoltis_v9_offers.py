#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def post_charge(tariff, night_exemption=None):
    fee = {
        'graceMinutes': int(tariff['graceMinutes']),
        'blockMinutes': 60,
        'blockEur': float(tariff['postChargeEurPerHour']),
        'rounding': 'started_block',
        'trigger': 'once_vehicle_is_charged',
    }
    if night_exemption:
        start, end = night_exemption.split('-', 1)
        fee['exemptLocalWindows'] = [{'start': start, 'end': end}]
    return fee


def offer(offer_id, source, price, min_kw, max_kw, profile, subscription_id=None, card_cost=None, night_exemption=None, grace_tariff=None):
    row = {
        'id': offer_id,
        'selectionId': subscription_id or offer_id,
        'provider': 'SYDER-QOVOLTIS direct',
        'networkAliases': ['SYDER-QOVOLTIS', 'SYDER QOVOLTIS', 'QOVOLTIS SYDER'],
        'operatorAliases': [],
        'countries': ['FR'],
        'connectorKinds': ['AC', 'DC'],
        'minPowerKw': min_kw,
        'maxPowerKw': max_kw,
        'currency': 'EUR',
        'priority': 125,
        'pricing': {
            'type': 'rules',
            'rules': [{'scope': 'allDay', 'start': '00:00', 'end': '24:00', 'billing': 'kwh', 'currency': 'EUR', 'pricePerKwh': float(price)}],
            'postChargeFee': post_charge(grace_tariff, night_exemption),
        },
        'source': source,
        'directOperatorOnly': False,
        'customerProfile': profile,
        'verifiedScope': 'exact_network_territory_power_customer_profile',
        'defaultSelected': False,
        'metadata': {
            'network': 'SYDER-QOVOLTIS',
            'authority': 'Syndicat Départemental d’Énergies du Rhône',
            'territory': 'Rhône hors Métropole de Lyon',
            'identityMode': 'physical_network_and_territory',
            'timeZone': 'Europe/Paris',
            'roamingSeparate': True,
            'networkWideGeneralization': True,
            'stationRuleReplicationRequired': False,
        },
    }
    if subscription_id:
        row['subscriptionId'] = subscription_id
    if card_cost is not None:
        row['metadata']['oneTimeCardPurchaseEur'] = float(card_cost)
        row['metadata']['recurringSubscriptionFeeEur'] = 0
    return row


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', default='data/v9/france-qovoltis-offers.json')
    a = p.parse_args()
    src = load(a.input)

    assert src['operator'] == 'SYDER-QOVOLTIS'
    assert src['tccDecision']['operatorValidated'] is True
    assert src['tccDecision']['directTariffClassable'] is True
    assert src['tccDecision']['powerAndCustomerProfileRequired'] is True
    assert src['tccDecision']['postChargeMustBeModeled'] is True
    assert src['tccDecision']['roamingSeparate'] is True

    low = src['directTariffs']['le50AcDc']
    high = src['directTariffs']['gt50AcDc']
    source = 'data-lab/data/operator_direct/syder_qovoltis_official_auvergne_rhone_alpes.json'
    card_id = 'syder-qovoltis-card'
    card_cost = src['rfidCardPurchaseEur']

    direct = [
        offer('syder-qovoltis-le50-public', source, low['otherUserEurPerKwh'], 0, 50, 'other_user', night_exemption=low['postChargeNightExemption'], grace_tariff=low),
        offer('syder-qovoltis-gt50-public', source, high['otherUserEurPerKwh'], 50.000001, None, 'other_user', grace_tariff=high),
    ]
    subscriptions = [
        offer('syder-qovoltis-le50-card', source, low['syderQovoltisCardEurPerKwh'], 0, 50, 'syder_qovoltis_card', subscription_id=card_id, card_cost=card_cost, night_exemption=low['postChargeNightExemption'], grace_tariff=low),
        offer('syder-qovoltis-gt50-card', source, high['syderQovoltisCardEurPerKwh'], 50.000001, None, 'syder_qovoltis_card', subscription_id=card_id, card_cost=card_cost, grace_tariff=high),
    ]

    out = {
        'schemaVersion': 1,
        'country': 'FR',
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'mode': 'verified_exact_network_territory',
        'policy': {
            'identityMode': 'physical_network_and_territory',
            'territory': 'Rhône hors Métropole de Lyon',
            'powerClassRequired': True,
            'customerProfileRequired': True,
            'subscriptionsOptIn': True,
            'rfidCardIsOptInEntitlement': True,
            'rfidCardRecurringFeeEur': 0,
            'postChargePreservedExactly': True,
            'lowerPowerNightPostChargeExemptionPreserved': True,
            'roamingSeparate': True,
            'noGeographicFallback': True,
        },
        'directOffers': direct,
        'subscriptionOffers': subscriptions,
        'sourceEvidence': src.get('sourceEvidence'),
        'networkSnapshot': src.get('networkSnapshot'),
    }
    path = Path(a.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'directOfferCount': len(direct), 'subscriptionOfferCount': len(subscriptions), 'output': str(path)}, indent=2))


if __name__ == '__main__':
    main()
