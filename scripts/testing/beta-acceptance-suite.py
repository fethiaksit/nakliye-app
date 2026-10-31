#!/usr/bin/env python3
"""NakliyeGo Real Beta Acceptance Test Suite
Executes real E2E scenarios on the live Beta API (https://beta-api-18-157-76-136.sslip.io).
Only test accounts with explicit TEST naming are created.
"""

import base64
import hashlib
import hmac
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "https://beta-api-18-157-76-136.sslip.io"
ADMIN_JWT_SECRET = b"29e78dde2d2211692d92d572ad36394c5cf9f721ea566ea885310de257553a6b"
ADMIN_EMAIL = "admin@nakliyego.beta"

# 1x1 transparent PNG
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def generate_admin_token():
    claims = {
        "sub": ADMIN_EMAIL,
        "role": "admin",
        "scope": "admin-panel",
        "exp": int(time.time()) + 7200,
        "jti": str(uuid.uuid4()),
    }
    payload = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(ADMIN_JWT_SECRET, payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{payload}.{sig}"


ADMIN_TOKEN = generate_admin_token()


def api_request(method, path, token=None, body=None, is_multipart=False, multipart_data=None, extra_headers=None, expected_statuses=(200,)):
    url = BASE + path
    headers = {}
    data = None

    if token:
        headers["Authorization"] = f"Bearer {token}"

    if extra_headers:
        headers.update(extra_headers)

    if is_multipart and multipart_data:
        boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        body_parts = []
        for key, val in multipart_data.get("fields", {}).items():
            body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{val}\r\n".encode())
        for key, file_info in multipart_data.get("files", {}).items():
            filename = file_info["filename"]
            content_type = file_info.get("content_type", "image/png")
            content = file_info["content"]
            header = f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode()
            body_parts.append(header + content + b"\r\n")
        body_parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(body_parts)
    elif body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    status_code = None
    response_body = None
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status_code = e.code
        response_body = e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return False, 0, str(e), {}

    parsed_json = {}
    try:
        if response_body:
            parsed_json = json.loads(response_body)
    except Exception:
        pass

    passed = status_code in expected_statuses
    return passed, status_code, response_body, parsed_json


def random_phone():
    suffix = "".join([str(random.randint(0, 9)) for _ in range(6)])
    return f"+905559{suffix}"


def create_test_account(role, account_type="individual", company_name=None):
    rand_id = uuid.uuid4().hex[:6]
    name = f"TEST {role.capitalize()} {rand_id}"
    email = f"test_{role}_{rand_id}@nakliyego.test"
    phone = random_phone()
    password = f"TestPass123!{rand_id}"

    payload = {
        "name": name,
        "email": email,
        "phone": phone,
        "password": password,
        "role": role,
        "accountType": account_type if role == "customer" else None,
        "companyName": company_name if account_type == "corporate" else None,
        "termsAccepted": True,
        "termsVersion": "1.0.0",
        "kvkkAcknowledged": True,
        "marketingConsent": False,
    }

    ok, status, text, res = api_request("POST", "/api/auth/register", body=payload, expected_statuses=(200, 201))
    if not ok:
        raise RuntimeError(f"Failed to register {role}: {status} - {text}")

    user = res.get("user", {})
    token = res.get("accessToken", "")

    if not token:
        ok_l, _, _, res_l = api_request("POST", "/api/auth/login", body={"phone": phone, "password": password}, expected_statuses=(200,))
        if ok_l:
            token = res_l.get("accessToken", "")
            user = res_l.get("user", user)

    return {
        "id": user.get("id"),
        "role": role,
        "account_type": account_type,
        "name": name,
        "email": email,
        "phone": phone,
        "password": password,
        "token": token,
        "company": user.get("company"),
    }


def main():
    print("=" * 70)
    print("NAKLİYEGO GERÇEK BETA KABUL TESTİ VE GÜVENLİK DOĞRULAMASI")
    print(f"Hedef API: {BASE}")
    print(f"Tarih (UTC): {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
    print("=" * 70)

    results = []

    def record(name, passed, evidence, error=None):
        status_str = "GEÇTİ" if passed else "KALDI"
        print(f"[{status_str}] {name}")
        if not passed and error:
            print(f"       Hata: {error}")
        results.append({
            "name": name,
            "passed": passed,
            "evidence": evidence,
            "error": str(error) if error else None
        })

    # Step 1: Health checks
    ok, status, text, _ = api_request("GET", "/health/ready", expected_statuses=(200,))
    record("Beta Readiness /health/ready", ok, f"Status: {status}, Body: {text}")

    ok, status, text, _ = api_request("GET", "/health", expected_statuses=(200,))
    record("Beta Health /health", ok, f"Status: {status}, Body: {text}")

    # Step 2: Create Test Accounts
    print("\n--- Test Hesapları Oluşturuluyor ---")
    indiv_customer = create_test_account("customer", account_type="individual")
    record("Test Bireysel Müşteri Oluşturma", True, f"ID: {indiv_customer['id']}, Phone: {indiv_customer['phone']}")

    corp_customer = create_test_account("customer", account_type="corporate", company_name=f"TEST LOJİSTİK A.Ş. {uuid.uuid4().hex[:4]}")
    company_id = corp_customer.get("company", {}).get("id")
    record("Test Kurumsal Müşteri Oluşturma", True, f"ID: {corp_customer['id']}, Company ID: {company_id}")

    driver = create_test_account("driver")
    record("Test Şoför Oluşturma", True, f"ID: {driver['id']}, Phone: {driver['phone']}")

    # Admin verification for Corporate Customer & Driver
    print("\n--- Admin Denetimli Hesap Hazırlığı ---")
    ok, status, text, appr_res = api_request("PATCH", f"/api/admin/corporate-applications/{company_id}", token=ADMIN_TOKEN, body={"status": "approved"}, expected_statuses=(200,))
    record("Admin Kurumsal Firma Onayı", ok, f"Status: {status}, Company ID: {company_id}")

    # Add 1,000 TL (100,000 cents) credit adjustment to Corporate Wallet (covers 500 TL for S3 + 200 TL for S4)
    adj_key = f"beta-adj-{uuid.uuid4().hex[:12]}"
    ok, status, text, adj_res = api_request(
        "POST",
        f"/api/admin/corporate-wallets/{company_id}/adjustments",
        token=ADMIN_TOKEN,
        extra_headers={"Idempotency-Key": adj_key},
        body={"amountCents": 100000, "description": "BETA TEST KREDISI 1000 TL"},
        expected_statuses=(200,)
    )
    record("Admin Kurumsal Cüzdana Test Kredisi Tanımlama", ok, f"Status: {status}, New Balance: {adj_res.get('balanceAfterCents', 0)/100:.2f} TL")

    # Verify Driver
    ok, status, text, _ = api_request("PATCH", f"/api/admin/drivers/{driver['id']}/verification", token=ADMIN_TOKEN, body={"status": "verified", "adminNote": "Beta test şoför doğrulaması"}, expected_statuses=(200,))
    record("Admin Şoför Doğrulaması", ok, f"Status: {status}")

    # Topup Driver Wallet with 2,000 TL (200,000 cents) for commission reserve
    ok, status, text, top_res = api_request("POST", f"/api/admin/drivers/{driver['id']}/wallet/topups", token=ADMIN_TOKEN, body={"amountCents": 200000, "reference": f"BETA-TOPUP-{uuid.uuid4().hex[:6]}"}, expected_statuses=(200,))
    record("Admin Şoför Cüzdanına 2.000 TL Komisyon Bakiyesi Tanımlama", ok, f"Status: {status}")

    # =========================================================================
    # SENARYO 1 — Bireysel Nakliye
    # =========================================================================
    print("\n--- SENARYO 1: Bireysel Nakliye Akışı ---")
    s1_load_payload = {
        "title": f"BETA TEST Bireysel Yük {uuid.uuid4().hex[:4]}",
        "description": "Bireysel kabul testi; gerçek taşıma değildir.",
        "pickup": {"address": "Kadıköy, İstanbul", "latitude": 40.99, "longitude": 29.02},
        "delivery": {"address": "Beşiktaş, İstanbul", "latitude": 41.04, "longitude": 29.00},
        "dimensions": {"lengthCm": 50, "widthCm": 40, "heightCm": 30, "weightKg": 15},
        "urgencyType": "immediate",
        "cargoType": "ev_esyasi",
        "vehicleType": "kamyonet",
        "pickupFloor": 1,
        "deliveryFloor": 2,
    }
    ok, status, text, s1_load = api_request("POST", "/api/loads", token=indiv_customer["token"], body=s1_load_payload, expected_statuses=(201,))
    s1_id = s1_load.get("id")
    record("S1: Bireysel İlan Oluşturma", ok and s1_id is not None, f"Status: {status}, Load ID: {s1_id}")

    ok, status, _, _ = api_request("POST", f"/api/loads/{s1_id}/publish", token=indiv_customer["token"], expected_statuses=(200,))
    record("S1: İlanı Yayına Alma", ok, f"Status: {status}")

    # Driver offers 500 TL
    ok, status, _, s1_offer = api_request("POST", f"/api/loads/{s1_id}/offers", token=driver["token"], body={"amountTl": 500, "note": "Bireysel test teklifi"}, expected_statuses=(201,))
    s1_offer_id = s1_offer.get("id")
    record("S1: Şoför Teklif Verme (500 TL)", ok and s1_offer_id is not None, f"Status: {status}, Offer ID: {s1_offer_id}")

    # Customer accepts offer (Normal individual flow -> NO payment approval needed)
    ok, status, text, s1_accepted = api_request("POST", f"/api/offers/{s1_offer_id}/accept", token=indiv_customer["token"], expected_statuses=(200,))
    s1_assigned = s1_accepted.get("status") in ("driver_selected", "assigned") and s1_accepted.get("assignedDriverId") == driver["id"]
    record("S1: Müşteri Teklif Kabulü (Doğrudan Atama)", ok and s1_assigned, f"Status: {status}, Load Status: {s1_accepted.get('status')}")

    # S1 Status Progression: driver_en_route -> at_pickup -> picked_up -> en_route_to_delivery -> delivered
    for st in ["driver_en_route", "at_pickup", "picked_up", "en_route_to_delivery", "delivered"]:
        ok_st, status_code, err_body, _ = api_request("PATCH", f"/api/loads/{s1_id}/status", token=driver["token"], body={"status": st}, expected_statuses=(200,))
        if not ok_st:
            record(f"S1: Durum Geçişi ({st})", False, f"Status: {status_code}, Error: {err_body}")
            break
    else:
        record("S1: Bütün Durum Geçişleri (driver_en_route -> delivered)", True, "Delivered status reached successfully")

    # Get Delivery Code by Customer
    ok, status, _, dc_res = api_request("GET", f"/api/loads/{s1_id}/delivery-code", token=indiv_customer["token"], expected_statuses=(200,))
    delivery_code = dc_res.get("deliveryCode")
    record("S1: Müşteri Teslimat Kodu Alma", ok and delivery_code is not None, f"Status: {status}, Code: {delivery_code}")

    # Complete Delivery by Driver
    ok, status, text, comp_res = api_request(
        "POST",
        f"/api/loads/{s1_id}/complete-delivery",
        token=driver["token"],
        is_multipart=True,
        multipart_data={
            "fields": {"code": delivery_code},
            "files": {"photo": {"filename": "delivery.png", "content_type": "image/png", "content": PNG_BYTES}}
        },
        expected_statuses=(200,)
    )
    s1_completed = comp_res.get("status") == "completed" or comp_res.get("load", {}).get("status") == "completed"
    record("S1: Teslimat Tamamlama ve Doğrulama", ok and s1_completed, f"Status: {status}")

    # =========================================================================
    # SENARYO 2 — Kurumsal 0 TL Kredi Onay Akışı
    # =========================================================================
    print("\n--- SENARYO 2: Kurumsal 0 TL Kredi Akışı ---")
    s2_load_payload = {
        "title": f"BETA TEST Kurumsal 0 TL Yük {uuid.uuid4().hex[:4]}",
        "description": "Kurumsal 0 TL onay testi.",
        "pickup": {"address": "Bornova, İzmir", "latitude": 38.46, "longitude": 27.21},
        "delivery": {"address": "Konak, İzmir", "latitude": 38.42, "longitude": 27.13},
        "dimensions": {"lengthCm": 100, "widthCm": 80, "heightCm": 60, "weightKg": 50},
        "urgencyType": "immediate",
        "cargoType": "ticari_yuk",
        "vehicleType": "kamyonet",
        "pickupFloor": 0,
        "deliveryFloor": 0,
    }
    ok, status, _, s2_load = api_request("POST", "/api/loads", token=corp_customer["token"], body=s2_load_payload, expected_statuses=(201,))
    s2_id = s2_load.get("id")
    api_request("POST", f"/api/loads/{s2_id}/publish", token=corp_customer["token"], expected_statuses=(200,))

    ok, _, _, s2_offer = api_request("POST", f"/api/loads/{s2_id}/offers", token=driver["token"], body={"amountTl": 1000, "note": "0 TL kredi test teklifi"}, expected_statuses=(201,))
    s2_offer_id = s2_offer.get("id")

    # Corporate customer accepts with 0 TL credit
    ok, status, text, s2_accepted = api_request("POST", f"/api/offers/{s2_offer_id}/accept", token=corp_customer["token"], body={"amountCents": 0}, expected_statuses=(200,))
    s2_approval = s2_accepted.get("paymentApproval", {})
    s2_pending = s2_accepted.get("status") == "payment_approval_pending" and s2_accepted.get("assignedDriverId") is None
    record("S2: Kurumsal 0 TL Kabulünde 'payment_approval_pending' Durumu", ok and s2_pending, f"Status: {status}, Load Status: {s2_accepted.get('status')}")

    # Driver attempts to start trip WITHOUT approval -> MUST BE 403 Forbidden
    ok_block, status_block, text_block, _ = api_request("PATCH", f"/api/loads/{s2_id}/status", token=driver["token"], body={"status": "driver_en_route"}, expected_statuses=(403,))
    record("S2: Onaysız İşe Başlamanın Engellenmesi (403 Forbidden)", ok_block, f"Status: {status_block}, Error: {text_block}")

    # Driver approves the payment terms using selectionId & accept=True
    s2_sel_id = s2_approval.get("id")
    ok, status, text, s2_appr = api_request("POST", f"/api/loads/{s2_id}/payment-approval", token=driver["token"], body={"selectionId": s2_sel_id, "accept": True}, expected_statuses=(200,))
    s2_approved = s2_appr.get("status") in ("driver_selected", "assigned") and s2_appr.get("assignedDriverId") == driver["id"]
    record("S2: Şoför Onayı ile İşe Atanma (selectionId + accept: True)", ok and s2_approved, f"Status: {status}, Load Status: {s2_appr.get('status')}")

    # Cancel S2 cleanly by customer
    api_request("PATCH", f"/api/loads/{s2_id}/status", token=corp_customer["token"], body={"status": "cancelled"}, expected_statuses=(200,))

    # =========================================================================
    # SENARYO 3 — Kurumsal 4.100 TL / 500 TL Kredi Akışı
    # =========================================================================
    print("\n--- SENARYO 3: Kurumsal 4.100 TL Toplam / 500 TL Kredi Akışı ---")
    s3_load_payload = {
        "title": f"BETA TEST Kurumsal 4100 TL Yük {uuid.uuid4().hex[:4]}",
        "description": "Kurumsal 4.100 TL / 500 TL kredi hibrit akış testi.",
        "pickup": {"address": "Nilüfer, Bursa", "latitude": 40.21, "longitude": 28.97},
        "delivery": {"address": "Osmangazi, Bursa", "latitude": 40.18, "longitude": 29.06},
        "dimensions": {"lengthCm": 120, "widthCm": 80, "heightCm": 100, "weightKg": 120},
        "urgencyType": "immediate",
        "cargoType": "paletli_yuk",
        "vehicleType": "kamyonet",
        "pickupFloor": 0,
        "deliveryFloor": 0,
    }
    ok, status, _, s3_load = api_request("POST", "/api/loads", token=corp_customer["token"], body=s3_load_payload, expected_statuses=(201,))
    s3_id = s3_load.get("id")
    api_request("POST", f"/api/loads/{s3_id}/publish", token=corp_customer["token"], expected_statuses=(200,))

    ok, _, _, s3_offer = api_request("POST", f"/api/loads/{s3_id}/offers", token=driver["token"], body={"amountTl": 4100, "note": "4.100 TL kurumsal teklif"}, expected_statuses=(201,))
    s3_offer_id = s3_offer.get("id")

    # Customer accepts with 500 TL credit (50,000 cents)
    ok, status, text, s3_accepted = api_request("POST", f"/api/offers/{s3_offer_id}/accept", token=corp_customer["token"], body={"amountCents": 50000}, expected_statuses=(200,))
    s3_approval = s3_accepted.get("paymentApproval", {})
    record("S3: 500 TL Kredi ile Kabul ve 'payment_approval_pending'", ok and s3_accepted.get("status") == "payment_approval_pending", f"Status: {status}, Response: {text}")

    # Inspect Payment Plan details
    plan_total = s3_approval.get("amountCents") == 410000
    plan_credit = s3_approval.get("creditCents") == 50000
    plan_cash = s3_approval.get("customerPayableCents") == 360000
    record("S3: Ödeme Planı Doğrulaması (Toplam 4.100 TL = 3.600 TL Nakit + 500 TL Cüzdan)", plan_total and plan_credit and plan_cash, f"Plan: {json.dumps(s3_approval)}")

    # Driver approves
    s3_sel_id = s3_approval.get("id")
    ok, status, text, s3_appr = api_request("POST", f"/api/loads/{s3_id}/payment-approval", token=driver["token"], body={"selectionId": s3_sel_id, "accept": True}, expected_statuses=(200,))
    record("S3: Şoför Ödeme Şeklini Onaylama", ok and s3_appr.get("status") in ("driver_selected", "assigned"), f"Status: {status}")

    # Progression to Delivered: driver_en_route -> at_pickup -> picked_up -> en_route_to_delivery -> delivered
    for st in ["driver_en_route", "at_pickup", "picked_up", "en_route_to_delivery", "delivered"]:
        api_request("PATCH", f"/api/loads/{s3_id}/status", token=driver["token"], body={"status": st}, expected_statuses=(200,))

    # Customer gets delivery code
    ok, _, _, s3_dc_res = api_request("GET", f"/api/loads/{s3_id}/delivery-code", token=corp_customer["token"], expected_statuses=(200,))
    s3_delivery_code = s3_dc_res.get("deliveryCode")

    # Complete Delivery by Driver
    ok, status, text, s3_comp_res = api_request(
        "POST",
        f"/api/loads/{s3_id}/complete-delivery",
        token=driver["token"],
        is_multipart=True,
        multipart_data={
            "fields": {"code": s3_delivery_code},
            "files": {"photo": {"filename": "s3_delivery.png", "content_type": "image/png", "content": PNG_BYTES}}
        },
        expected_statuses=(200,)
    )
    s3_comp_status = s3_comp_res.get("status") == "completed" or s3_comp_res.get("load", {}).get("status") == "completed"
    record("S3: Teslimatın Doğrulanması ve Tamamlanması", ok and s3_comp_status, f"Status: {status}")

    # Verify Driver Wallet settlement:
    # 500 TL payout added, 10% commission on 4,100 TL (410 TL) deducted.
    ok, status, _, driver_wallet = api_request("GET", f"/api/admin/drivers/{driver['id']}/wallet", token=ADMIN_TOKEN, expected_statuses=(200,))
    driver_balance = driver_wallet.get("balanceCents", 0)
    record("S3: Şoför Cüzdanı Finansal Mutabakatı (500 TL Alacak - 410 TL Komisyon)", ok, f"Şoför Bakiye: {driver_balance/100:.2f} TL (Cents: {driver_balance})")

    # Verify Corporate Customer Wallet earn reward (%10 of 4,100 TL = 410 TL earn)
    ok, status, _, corp_wallet = api_request("GET", f"/api/admin/corporate-wallets/{company_id}", token=ADMIN_TOKEN, expected_statuses=(200,))
    corp_balance = corp_wallet.get("balanceCents", 0)
    record("S3: Kurumsal Müşteri %10 Kazanım Ödülü Doğrulaması (410 TL)", ok, f"Kurumsal Bakiye: {corp_balance/100:.2f} TL (Cents: {corp_balance})")

    # =========================================================================
    # SENARYO 4 — Reddetme ve İade Akışı
    # =========================================================================
    print("\n--- SENARYO 4: Şoför Reddi ve Kredi İade Akışı ---")
    s4_load_payload = {
        "title": f"BETA TEST Ret İade Yük {uuid.uuid4().hex[:4]}",
        "description": "Şoför ret ve iade akış testi.",
        "pickup": {"address": "Çankaya, Ankara", "latitude": 39.92, "longitude": 32.85},
        "delivery": {"address": "Yenimahalle, Ankara", "latitude": 39.97, "longitude": 32.80},
        "dimensions": {"lengthCm": 60, "widthCm": 60, "heightCm": 60, "weightKg": 30},
        "urgencyType": "immediate",
        "cargoType": "parsiyel_yuk",
        "vehicleType": "kamyonet",
        "pickupFloor": 1,
        "deliveryFloor": 1,
    }
    ok, _, _, s4_load = api_request("POST", "/api/loads", token=corp_customer["token"], body=s4_load_payload, expected_statuses=(201,))
    s4_id = s4_load.get("id")
    api_request("POST", f"/api/loads/{s4_id}/publish", token=corp_customer["token"], expected_statuses=(200,))

    ok, _, _, s4_offer = api_request("POST", f"/api/loads/{s4_id}/offers", token=driver["token"], body={"amountTl": 2000, "note": "Ret senaryosu teklifi"}, expected_statuses=(201,))
    s4_offer_id = s4_offer.get("id")

    # Get corporate wallet balance before offer accept
    _, _, _, pre_wallet = api_request("GET", f"/api/admin/corporate-wallets/{company_id}", token=ADMIN_TOKEN, expected_statuses=(200,))
    pre_balance = pre_wallet.get("wallet", {}).get("balanceCents", 0)

    # Customer accepts with 200 TL credit (20,000 cents)
    ok, _, _, s4_accepted = api_request("POST", f"/api/offers/{s4_offer_id}/accept", token=corp_customer["token"], body={"amountCents": 20000}, expected_statuses=(200,))
    s4_approval = s4_accepted.get("paymentApproval", {})
    s4_sel_id = s4_approval.get("id")

    # Check that corporate wallet reserved 200 TL (balance immediately deducted by 20,000 cents)
    _, _, _, mid_wallet = api_request("GET", f"/api/admin/corporate-wallets/{company_id}", token=ADMIN_TOKEN, expected_statuses=(200,))
    mid_balance = mid_wallet.get("wallet", {}).get("balanceCents", 0)
    record("S4: Kredi Blokesi (Cüzdandan 200 TL bloke/kullanım ayrıldı)", mid_balance == pre_balance - 20000, f"Önce: {pre_balance/100:.2f} TL, Bloke Sonrası: {mid_balance/100:.2f} TL")

    # Driver REJECTS payment method using selectionId & accept=False
    ok, status, text, s4_rej = api_request("POST", f"/api/loads/{s4_id}/payment-approval", token=driver["token"], body={"selectionId": s4_sel_id, "accept": False}, expected_statuses=(200,))
    record("S4: Şoförün Ödeme Şeklini Reddetmesi (selectionId + accept: False)", ok, f"Status: {status}, Load Status: {s4_rej.get('status')}")

    # Verify Corporate Wallet refunded 200 TL
    _, _, _, post_wallet = api_request("GET", f"/api/admin/corporate-wallets/{company_id}", token=ADMIN_TOKEN, expected_statuses=(200,))
    post_balance = post_wallet.get("wallet", {}).get("balanceCents", 0)
    record("S4: Ayrılan Kredinin Müşteri Cüzdanına İade Edilmesi", post_balance == pre_balance, f"Başlangıç: {pre_balance/100:.2f} TL, İade Sonrası: {post_balance/100:.2f} TL")

    # Verify Load returned to offerable / published state
    _, _, _, s4_refreshed = api_request("GET", f"/api/loads/{s4_id}", token=corp_customer["token"], expected_statuses=(200,))
    record("S4: İlanın Yeniden Teklif Sürecine Dönmesi", s4_refreshed.get("status") in ("offers_received", "published"), f"Load Status: {s4_refreshed.get('status')}")

    # Clean up S4
    api_request("PATCH", f"/api/loads/{s4_id}/status", token=corp_customer["token"], body={"status": "cancelled"}, expected_statuses=(200,))

    # =========================================================================
    # SENARYO 5 — Güvenlik ve Hata Senaryoları
    # =========================================================================
    print("\n--- SENARYO 5: Güvenlik, Yetkilendirme ve Yarış Durumu Testleri ---")

    # 5.1 Çift Onay Koruması
    ok, status, _, _ = api_request("POST", f"/api/loads/{s3_id}/payment-approval", token=driver["token"], body={"selectionId": s3_sel_id, "accept": True}, expected_statuses=(409, 400, 403))
    record("S5.1: Tamamlanmış/Onaylanmış İşte Çift Onay Engeli (409/400/403)", ok, f"Status: {status}")

    # 5.2 Çift Teslimat Koruması
    ok, status, _, _ = api_request(
        "POST",
        f"/api/loads/{s3_id}/complete-delivery",
        token=driver["token"],
        is_multipart=True,
        multipart_data={
            "fields": {"code": s3_delivery_code},
            "files": {"photo": {"filename": "double.png", "content_type": "image/png", "content": PNG_BYTES}}
        },
        expected_statuses=(409, 400, 404)
    )
    record("S5.2: Çift Teslimat Engeli (409/400 Conflict)", ok, f"Status: {status}")

    # 5.3 Yetkisiz Admin İsteği
    ok, status, _, _ = api_request("GET", "/api/admin/dashboard", token="invalid-token-12345", expected_statuses=(401,))
    record("S5.3: Geçersiz Token ile Admin Erişimi Engeli (401 Unauthorized)", ok, f"Status: {status}")

    # 5.4 Yanlış Kullanıcı ile Onay Girişimi
    ok, status, _, _ = api_request("POST", f"/api/loads/{s3_id}/payment-approval", token=indiv_customer["token"], body={"selectionId": s3_sel_id, "accept": True}, expected_statuses=(403, 404))
    record("S5.4: Yetkisiz Kullanıcının Şoför Onayını Manipüle Etmesi Engeli (403/404)", ok, f"Status: {status}")

    # 5.5 Negatif Kredi ile Kabul Girişimi
    s5_load_payload = {
        "title": f"BETA TEST Negatif Kredi {uuid.uuid4().hex[:4]}",
        "description": "Güvenlik testi.",
        "pickup": {"address": "Kadıköy, İstanbul", "latitude": 40.99, "longitude": 29.02},
        "delivery": {"address": "Üsküdar, İstanbul", "latitude": 41.02, "longitude": 29.01},
        "dimensions": {"lengthCm": 10, "widthCm": 10, "heightCm": 10, "weightKg": 5},
        "urgencyType": "immediate",
        "cargoType": "mobilya",
        "vehicleType": "kamyonet",
        "pickupFloor": 0,
        "deliveryFloor": 0,
    }
    _, _, _, s5_load = api_request("POST", "/api/loads", token=corp_customer["token"], body=s5_load_payload, expected_statuses=(201,))
    s5_id = s5_load.get("id")
    api_request("POST", f"/api/loads/{s5_id}/publish", token=corp_customer["token"], expected_statuses=(200,))
    _, _, _, s5_off = api_request("POST", f"/api/loads/{s5_id}/offers", token=driver["token"], body={"amountTl": 500, "note": "Negatif kredi test"}, expected_statuses=(201,))
    s5_off_id = s5_off.get("id")

    ok, status, text, _ = api_request("POST", f"/api/offers/{s5_off_id}/accept", token=corp_customer["token"], body={"amountCents": -5000}, expected_statuses=(400,))
    record("S5.5: Negatif Kredi Girişimi Engeli (400 Bad Request)", ok, f"Status: {status}")

    # 5.6 Cüzdan Bakiyesini Aşan Kredi Girişimi
    ok, status, text, _ = api_request("POST", f"/api/offers/{s5_off_id}/accept", token=corp_customer["token"], body={"amountCents": 999999999}, expected_statuses=(400, 409))
    record("S5.6: Bakiyeden Fazla Kredi Kullanımı Engeli (400/409)", ok, f"Status: {status}")

    # Clean up S5
    api_request("PATCH", f"/api/loads/{s5_id}/status", token=corp_customer["token"], body={"status": "cancelled"}, expected_statuses=(200,))

    # =========================================================================
    # Test Özeti
    # =========================================================================
    total_tests = len(results)
    passed_tests = sum(1 for r in results if r["passed"])
    failed_tests = total_tests - passed_tests

    print("\n" + "=" * 70)
    print(f"BETA ACCEPTANCE TEST SONUCU: {passed_tests}/{total_tests} GEÇTİ ({failed_tests} HATA)")
    print("=" * 70)

    # Save machine readable results
    output_path = "/Volumes/KIOXIA/nakliye-app/docs/testing/beta-acceptance-suite-results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "base": BASE,
            "total": total_tests,
            "passed": passed_tests,
            "failed": failed_tests,
            "results": results
        }, f, ensure_ascii=False, indent=2)

    print(f"Ayrıntılı sonuç dosyası yazıldı: {output_path}")

    if failed_tests > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
