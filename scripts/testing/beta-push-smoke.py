#!/usr/bin/env python3
"""Trigger real beta events using two phone-authenticated TEST accounts.
No secrets are printed or stored in the state file. APNs/Expo credentials and
actual device registration must already be configured. This script cannot prove
that an iOS banner was displayed: record that observation on the phone.
"""
import argparse
import json
import pathlib
import urllib.error
import urllib.request
import uuid

BASE = 'https://beta-api-18-157-76-136.sslip.io'
PREFIX = 'BETA PUSH TEST '


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['create', 'accept', 'reject', 'message', 'start', 'cancel'])
    p.add_argument('--customer-token-file', type=pathlib.Path, required=True)
    p.add_argument('--driver-token-file', type=pathlib.Path, required=True)
    p.add_argument('--state', type=pathlib.Path, default=pathlib.Path('/tmp/nakliyego-beta-push-state.json'))
    p.add_argument('--credit-cents', type=int, default=50000)
    p.add_argument('--repeat', action='store_true', help='Replay a decision/message and check no duplicate event succeeds')
    args = p.parse_args()
    customer = args.customer_token_file.read_text().strip()
    driver = args.driver_token_file.read_text().strip()
    if not customer or not driver:
        p.error('Token files must contain the beta test accounts access tokens.')

    def api(method, path, token, body=None, expected=(200,)):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method, headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                status, payload = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, payload = e.code, e.read()
        print(method, path, status)
        if status not in expected:
            raise RuntimeError('Unexpected response: ' + payload[:500].decode(errors='replace'))
        return json.loads(payload) if payload else None

    if args.action == 'create':
        if args.state.exists():
            p.error('State file exists. Cancel the prior test shipment and use a new state file.')
        load = api('POST', '/api/loads', customer, {
            'title': PREFIX + str(uuid.uuid4())[:8], 'description': 'Push kabul testi; gerçek taşıma değildir.',
            'pickup': {'address': 'Bornova, İzmir', 'latitude': 38.46, 'longitude': 27.21},
            'delivery': {'address': 'Konak, İzmir', 'latitude': 38.42, 'longitude': 27.13},
            'dimensions': {'lengthCm': 80, 'widthCm': 60, 'heightCm': 50, 'weightKg': 40},
            'urgencyType': 'immediate', 'cargoType': 'ticari_yuk', 'vehicleType': 'kamyonet',
            'pickupFloor': 0, 'deliveryFloor': 0}, expected=(201,))
        lid = load['id']
        args.state.write_text(json.dumps({'base': BASE, 'loadId': lid}, indent=2))
        api('POST', f'/api/loads/{lid}/publish', customer)
        offer = api('POST', f'/api/loads/{lid}/offers', driver, {'amountTl': 4100, 'note': 'Beta push testi'}, expected=(201,))
        pending = api('POST', f'/api/offers/{offer["id"]}/accept', customer, {'amountCents': args.credit_cents})
        assert pending['status'] == 'payment_approval_pending' and not pending.get('assignedDriverId')
        api('PATCH', f'/api/loads/{lid}/status', driver, {'status': 'driver_en_route'}, expected=(403, 409))
        print('Verify offer push on customer and payment approval push on driver; no automatic job start.')
        return

    state = json.loads(args.state.read_text())
    if state['base'] != BASE:
        p.error('Only beta state is supported.')
    lid = state['loadId']
    load = api('GET', f'/api/loads/{lid}', customer)
    if not load['title'].startswith(PREFIX):
        p.error('Refusing to modify a shipment not created by this test runner.')
    if args.action in ('accept', 'reject'):
        body = {'selectionId': load['paymentApproval']['id'], 'accept': args.action == 'accept'}
        api('POST', f'/api/loads/{lid}/payment-approval', driver, body)
        if args.repeat:
            api('POST', f'/api/loads/{lid}/payment-approval', driver, body, expected=(409,))
        print('Verify one payment decision push on customer; tap must fetch the current shipment.')
    elif args.action == 'message':
        body = {'type': 'text', 'body': 'Beta iPhone push testi', 'clientMessageId': str(uuid.uuid4())}
        api('POST', f'/api/conversations/{lid}/messages', driver, body, expected=(201,))
        if args.repeat:
            api('POST', f'/api/conversations/{lid}/messages', driver, body, expected=(200,))
        print('Verify one customer message push; tap opens this conversation.')
    elif args.action == 'start':
        api('PATCH', f'/api/loads/{lid}/status', driver, {'status': 'driver_en_route'})
        print('Verify customer shipment status push. This requires prior driver approval.')
    else:
        api('PATCH', f'/api/loads/{lid}/status', customer, {'status': 'cancelled'})
        print('Test shipment cancelled. Verify credit refund and released driver reservation.')


if __name__ == '__main__':
    main()
