import XCTest

final class NakliyeGoFunctionalUITests: XCTestCase {
    private var role: String { TestConfiguration.role }
    private var phone: String { TestConfiguration.phone }
    private var password: String { TestConfiguration.password }
    private var otherParty: String { TestConfiguration.otherParty }
    private var bundleIdentifier: String { TestConfiguration.bundleIdentifier }

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCTAssertFalse(bundleIdentifier.isEmpty, "Test bundle identifier is required")
        XCTAssertFalse(phone.isEmpty, "Test phone is required")
        addUIInterruptionMonitor(withDescription: "iOS password save prompt") { alert in
            let later = alert.buttons["Sonra"]
            if later.exists {
                later.tap()
                return true
            }
            let notNow = alert.buttons["Şimdi Değil"]
            if notNow.exists {
                notNow.tap()
                return true
            }
            return false
        }
    }

    func testNativeDateAndConversationComposer() throws {
        let app = XCUIApplication(bundleIdentifier: bundleIdentifier)
        app.launch()
        loginIfNeeded(app)

        if role == "customer" {
            verifyNativeDatePicker(app)
        }
        verifyConversationComposer(app)
    }

    private func labeled(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func containingLabel(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    }

    private func loginIfNeeded(_ app: XCUIApplication) {
        if labeled(app, "Mesajlar").waitForExistence(timeout: 2) { return }
        let phoneField = app.textFields.element(boundBy: 0)
        XCTAssertTrue(phoneField.waitForExistence(timeout: 8), "Login phone input did not appear")
        phoneField.tap()
        phoneField.typeText(phone)
        let passwordField = app.secureTextFields.element(boundBy: 0)
        XCTAssertTrue(passwordField.waitForExistence(timeout: 2), "Login password input did not appear")
        passwordField.tap()
        passwordField.typeText(password)
        labeled(app, "Giriş yap").tap()
        XCTAssertTrue(labeled(app, "Mesajlar").waitForExistence(timeout: 12), "Application did not reach the authenticated navigation")
        app.tap()
    }

    private func verifyNativeDatePicker(_ app: XCUIApplication) {
        let planned = labeled(app, "Planlı")
        XCTAssertTrue(planned.waitForExistence(timeout: 8), "Planned transport option did not appear")
        planned.tap()

        let dateButton = app.buttons["Tarih"]
        XCTAssertTrue(dateButton.waitForExistence(timeout: 4), "Scheduled date field did not appear")
        for _ in 0..<4 where !dateButton.isHittable { app.swipeUp() }
        XCTAssertTrue(dateButton.isHittable, "Scheduled date field could not be scrolled into the touchable viewport")
        dateButton.tap()
        XCTAssertTrue(app.pickerWheels.firstMatch.waitForExistence(timeout: 4), "Native iOS date picker did not open")
        XCTAssertTrue(labeled(app, "İptal").exists, "Date picker cancel action is missing")
        labeled(app, "Tamam").tap()

        let selectedValue = String(describing: dateButton.value ?? "")
        XCTAssertTrue(selectedValue.range(of: #"\d{1,2} [[:alpha:]çğıöşüÇĞİÖŞÜ]+ 20\d{2}"#, options: .regularExpression) != nil, "Selected date was not written back in Turkish readable format: \(selectedValue)")

        dateButton.tap()
        XCTAssertTrue(app.pickerWheels.firstMatch.waitForExistence(timeout: 4), "Date picker did not reopen with the selected value")
        labeled(app, "İptal").tap()
        XCTAssertEqual(String(describing: dateButton.value ?? ""), selectedValue, "Cancel changed the selected date")
    }

    private func verifyConversationComposer(_ app: XCUIApplication) {
        labeled(app, "Mesajlar").tap()
        let party = containingLabel(app, otherParty)
        XCTAssertTrue(party.waitForExistence(timeout: 12), "Prepared conversation did not appear")
        party.tap()

        let input = app.descendants(matching: .any)["conversation-message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8), "Message input did not appear")
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4), "A single tap did not open the iOS keyboard")

        let message = "UI keyboard \(role) \(Int(Date().timeIntervalSince1970))"
        input.typeText(message)
        XCTAssertTrue(String(describing: input.value ?? "").contains(message), "Typed text was not retained in the input state")

        let sendButton = app.descendants(matching: .any)["conversation-send-button"]
        XCTAssertTrue(sendButton.isEnabled, "Send button remained disabled for a non-empty message")
        sendButton.tap()
        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 12), "Sent message did not appear in the conversation")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Keyboard closed unnecessarily after sending")
        XCTAssertFalse(String(describing: input.value ?? "").contains(message), "Input was not cleared after a successful send")
    }
}
