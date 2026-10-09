import XCTest

final class ProductionDeskUITests: XCTestCase {
    @MainActor func testPopulatedMobileViewsAndKeyboard() throws {
        let app = XCUIApplication(); app.launch()
        let web = app.webViews["production-desk-webview"]
        XCTAssertTrue(web.waitForExistence(timeout:15))
        let tools = web.buttons["Production tools"]
        if tools.exists && tools.isHittable { tools.tap() }
        let importButton = web.buttons.matching(NSPredicate(format:"label CONTAINS %@", "Import script / USS")).firstMatch
        XCTAssertTrue(importButton.waitForExistence(timeout:10)); importButton.tap()
        let paste = web.textViews.firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout:5)); paste.tap()
        paste.typeText("1 INT. LIGHTHOUSE - DAWN\n\nThe first light crosses the water.\n\nMAYA\nWe have one chance.\n\n2 EXT. HARBOUR - DAY\n\nA boat waits at the dock.")
        // On iPad the keyboard accessory can cover the dialog footer.
        // Dismiss it explicitly so the tap reaches the import action.
        let dismissKeyboard = {
            let hideKeyboard = app.keyboards.buttons.matching(NSPredicate(format:"label CONTAINS[c] %@", "hide")).firstMatch
            if hideKeyboard.exists && hideKeyboard.isHittable {
                hideKeyboard.tap()
                let dismissed = XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == false"), object:app.keyboards.firstMatch)
                XCTAssertEqual(XCTWaiter.wait(for:[dismissed], timeout:5), .completed)
            }
        }
        dismissKeyboard()
        let submit = web.buttons["Import locally"]
        XCTAssertTrue(submit.exists && submit.isHittable); submit.tap()
        let imported = XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == false"), object:web.buttons["Close dialog"])
        XCTAssertEqual(XCTWaiter.wait(for:[imported], timeout:10), .completed)
        let breakdown = web.buttons["Main breakdown"]
        XCTAssertTrue(breakdown.waitForExistence(timeout:10))
        XCTAssertTrue(web.staticTexts.matching(NSPredicate(format:"label CONTAINS %@", "LIGHTHOUSE")).firstMatch.waitForExistence(timeout:10))
        for label in ["Main breakdown", "Shooting schedule", "Shot list"] {
            web.buttons[label].tap()
            if label == "Shot list" {
                web.buttons.matching(NSPredicate(format:"label CONTAINS %@", "New shot")).firstMatch.tap()
                let description = web.textViews.firstMatch
                XCTAssertTrue(description.waitForExistence(timeout:5))
                description.typeText("Maya watches the first light over the harbour")
                let keyboard = XCTAttachment(screenshot:app.screenshot())
                keyboard.name="Shot creation with keyboard"; keyboard.lifetime = .keepAlways; add(keyboard)
                dismissKeyboard()
                web.buttons["Add shot"].tap()
                XCTAssertTrue(web.staticTexts["Maya watches the first light over the harbour"].firstMatch.waitForExistence(timeout:10))
            }
            // Re-select after modal/keyboard dismissal so evidence starts at the top.
            web.buttons[label].tap()
            let shot = XCTAttachment(screenshot:app.screenshot())
            shot.name="Branded populated \(label)"; shot.lifetime = .keepAlways; add(shot)
        }
        web.buttons["Main breakdown"].tap()
        let search = web.buttons["Search script"]
        if search.exists && search.isHittable {
            search.tap()
            let field=web.textFields["Search scenes"]
            XCTAssertTrue(field.waitForExistence(timeout:5)); field.typeText("LIGHTHOUSE")
            XCTAssertTrue(web.buttons["Search script"].exists)
        }
    }
    @MainActor func testJSONAndPDFShareSheetsCanBeDismissedAndReopened() throws {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews["production-desk-webview"]
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let export = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Export")).firstMatch
        XCTAssertTrue(export.waitForExistence(timeout: 15))
        for option in ["Full Production Desk backup", "Print / Save as PDF", "Full Production Desk backup"] {
            export.tap()
            let choice = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", option)).firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 5))
            choice.tap()
            let sheet = app.otherElements["ActivityListView"]
            XCTAssertTrue(sheet.waitForExistence(timeout: 10), app.debugDescription)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Native share sheet — \(option)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let close = app.buttons.matching(NSPredicate(format: "label == 'Close' OR label == 'Cancel'")).firstMatch
            if close.exists { close.tap() }
            else { app.otherElements["PopoverDismissRegion"].coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.1)).tap() }
            // Export modal remains open after file sharing, but PDF closes it.
            let modalClose = web.buttons["Close dialog"]
            if modalClose.exists { modalClose.tap() }
        }
    }

    @MainActor func testNavigationBackgroundAndRelaunch() throws {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews["production-desk-webview"]
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let breakdown = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Main breakdown")).firstMatch
        XCTAssertTrue(breakdown.waitForExistence(timeout: 15))
        let productionTitle = "Simulator \(UUID().uuidString.prefix(8))"
        let tools = web.buttons["Production tools"]
        if tools.exists && tools.isHittable { tools.tap() }
        web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New production")).firstMatch.tap()
        let titleField = web.textFields.firstMatch
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        // The production dialog focuses and selects its default title.
        titleField.typeText(productionTitle + "\n")
        XCTAssertTrue(web.staticTexts[productionTitle].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        for _ in 0..<3 {
            for label in ["Shooting schedule", "Shot list", "Elements", "Reports", "Main breakdown"] {
                let button = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
                XCTAssertTrue(button.exists, label)
                button.tap()
            }
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(breakdown.waitForExistence(timeout: 10))
        XCTAssertTrue(web.staticTexts[productionTitle].firstMatch.exists)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Main breakdown")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.staticTexts[productionTitle].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["native-load-error"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Production Desk after repeated navigation and relaunch"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
