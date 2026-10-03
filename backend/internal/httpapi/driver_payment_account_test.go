package httpapi

import (
	"nakliye-api/internal/models"
	"net/http"
	"testing"
)

func TestDriverPaymentAccountSettings(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	d := registerTestUser(t, h, "commission_empty_payment_account_driver", models.RoleDriver)
	c := registerTestUser(t, h, "payment_account_customer", models.RoleCustomer)
	admin := adminLoginForTest(t, h)
	path := "/api/admin/driver-wallets/payment-account"
	for _, token := range []string{"", d.AccessToken, c.AccessToken} {
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			r := requestJSON(t, h, method, path, token, map[string]any{})
			if r.Code != 401 && r.Code != 403 {
				t.Fatalf("settings exposed: %s status=%d", method, r.Code)
			}
		}
	}
	body := map[string]any{"enabled": true, "companyName": " Test Şirketi ", "bankName": " Test Bankası ", "iban": "tr33 0006 1005 1978 6457 8413 26"}
	r := requestJSON(t, h, http.MethodPut, path, admin.AccessToken, body)
	if r.Code != 200 {
		t.Fatalf("save %d: %s", r.Code, r.Body.String())
	}
	r = requestJSON(t, h, http.MethodGet, path, admin.AccessToken, nil)
	settings := decodeResponse[map[string]any](t, r)
	if settings["iban"] != "TR330006100519786457841326" || settings["companyName"] != "Test Şirketi" {
		t.Fatalf("settings=%#v", settings)
	}
	view := driverWalletForTest(t, h, d)
	payment, ok := view["paymentAccount"].(map[string]any)
	if !ok || payment["iban"] != settings["iban"] || view["paymentReference"] != "SOFOR-"+d.User.ID {
		t.Fatalf("driver view=%#v", view)
	}
	body["iban"] = "TR340006100519786457841326"
	r = requestJSON(t, h, http.MethodPut, path, admin.AccessToken, body)
	if r.Code != 400 {
		t.Fatalf("invalid checksum accepted: %d", r.Code)
	}
	body["iban"] = "TR330006100519786457841326"
	body["companyName"] = ""
	r = requestJSON(t, h, http.MethodPut, path, admin.AccessToken, body)
	if r.Code != 400 {
		t.Fatalf("missing recipient accepted: %d", r.Code)
	}
	body["companyName"] = "Yeni Şirket"
	r = requestJSON(t, h, http.MethodPut, path, admin.AccessToken, body)
	if r.Code != 200 {
		t.Fatalf("update status=%d", r.Code)
	}
	view = driverWalletForTest(t, h, d)
	if view["paymentAccount"].(map[string]any)["companyName"] != "Yeni Şirket" {
		t.Fatalf("driver still sees old account: %#v", view)
	}
	body["enabled"] = false
	r = requestJSON(t, h, http.MethodPut, path, admin.AccessToken, body)
	if r.Code != 200 {
		t.Fatalf("disable %d: %s", r.Code, r.Body.String())
	}
	view = driverWalletForTest(t, h, d)
	if view["paymentAccount"] != nil {
		t.Fatalf("disabled account exposed: %#v", view)
	}
	assertDriverBalance(t, h, d, 0, 0)
}

func TestUnconfiguredDriverPaymentAccount(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	d := registerTestUser(t, h, "commission_empty_unconfigured_payment_driver", models.RoleDriver)
	view := driverWalletForTest(t, h, d)
	if value, exists := view["paymentAccount"]; !exists || value != nil {
		t.Fatalf("unconfigured account=%#v", view)
	}
}
