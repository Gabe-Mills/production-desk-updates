import XCTest
import WebKit
import UIKit
@testable import ProductionDesk

/// Exercises the shipped ES modules, DOM controls and real native save bridge.
final class RuntimeWorkflowTests: XCTestCase {
    @MainActor private func openDesk() async throws -> DeskViewController {
        let controller = DeskViewController()
        controller.loadViewIfNeeded()
        for _ in 0..<150 {
            if let ready = try? await controller.webView.evaluateJavaScript("document.body?.dataset.appReady === 'true'"), ready as? Bool == true { return controller }
            try await Task.sleep(for: .milliseconds(100))
        }
        let content = try? await controller.webView.evaluateJavaScript("document.body?.innerText")
        XCTFail("Bundled application did not initialize: \(String(describing: content))")
        throw CocoaError(.coderReadCorrupt)
    }

    @MainActor func testScriptBreakdownScheduleShotUndoAndReopen() async throws {
        let desk = try await openDesk()
        let result = try await desk.webView.callAsyncJavaScript("""
        const $=s=>document.querySelector(s);
        const click=s=>{const el=$(s);if(!el)throw Error('Missing '+s);el.click();};
        const input=(s,value)=>{const el=$(s);if(!el)throw Error('Missing '+s);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
        const nav=v=>click('#navigation [data-view="'+v+'"]');
        click('#import-open');
        input('#paste-script','1 INT. KITCHEN - DAY\\n\\nA kettle whistles.\\n\\nMAYA\\nTime to go.\\n\\n2 EXT. ROAD - NIGHT\\n\\nThe car leaves.');
        click('#import-submit');
        for(let i=0;i<100&&$('#modal').open;i++)await new Promise(r=>setTimeout(r,25));
        if($('#modal').open)throw Error($('#modal-error').textContent);
        input('[data-field="description"]','Runtime verified synopsis');
        nav('schedule');click('[data-action="add-day"]');
        click('[data-move-strip]');
        $('#strip-move-target').value='1';$('#strip-move-target').dispatchEvent(new Event('change',{bubbles:true}));
        click('#strip-move-save');
        nav('shots');click('#add-scene');
        input('#new-shot-description','Wide master of Maya');click('#new-shot-save');
        input('[data-shot-field="takes"]','3');
        input('[data-shot-field="status"]','Done');
        // Undo and redo preserve the completed shot through a full workspace clone.
        click('#undo');click('#redo');
        nav('elements');
        // An inline edit must save while still focused, before change/blur fires.
        const element=$('[data-element-name]');const elementID=element.dataset.elementName;
        element.focus();input('[data-element-name]','Runtime element rename');
        if(!await window.productionDeskSave())throw Error('Focused element save did not finish');
        for(let i=0;i<3;i++){nav('elements');nav('reports');nav('workspace');nav('shots');}
        if(!await window.productionDeskSave())throw Error('Save did not finish');
        const w=await window.webkit.messageHandlers.scheduler.postMessage({operation:'load'});
        const p=w.projects.find(p=>p.id===w.activeProject);
        const {validateWorkspace}=await import('/film-native.js');validateWorkspace(w);
        return {id:p.id,scenes:p.breakdowns.length,description:p.breakdowns[0].description,
          script:p.breakdowns[0]._scriptText,days:p.stripboards[0].boards[0].breakdownIds.length,
          scheduled:p.stripboards[0].boards[0].breakdownIds[0].length,
          shots:p._shots.length,status:p._shots[0].status,takes:p._shots[0].takes,
          rendered:$('#shot-count').textContent,elementName:p.elements.find(e=>e.id===elementID).name};
        """, arguments: [:], in: nil, contentWorld: .page)
        let fields = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(fields["scenes"] as? Int, 2)
        XCTAssertEqual(fields["description"] as? String, "Runtime verified synopsis")
        XCTAssertTrue((fields["script"] as? String)?.contains("A kettle whistles.") == true)
        XCTAssertEqual(fields["days"] as? Int, 1)
        XCTAssertEqual(fields["scheduled"] as? Int, 1)
        XCTAssertEqual(fields["shots"] as? Int, 1)
        XCTAssertEqual(fields["status"] as? String, "Done")
        XCTAssertEqual(fields["takes"] as? Int, 3)
        XCTAssertEqual(fields["rendered"] as? String, "1 shots")
        XCTAssertEqual(fields["elementName"] as? String, "Runtime element rename")
        let reopened = try await openDesk()
        let restored = try await reopened.webView.callAsyncJavaScript("return await window.webkit.messageHandlers.scheduler.postMessage({operation:'load'});", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual((restored as? [String: Any])?["activeProject"] as? String, fields["id"] as? String)
    }

    @MainActor func testFinalDraftBrowserParserAndInvalidXML() async throws {
        let desk = try await openDesk()
        let result = try await desk.webView.callAsyncJavaScript("""
        const {importScript,validateUSS}=await import('/film-native.js');
        const xml='<FinalDraft><Content><Paragraph Type="Scene Heading" Number="42"><Text>INT. STUDIO - DAY</Text></Paragraph><Paragraph Type="Character"><Text>MAYA</Text></Paragraph><Paragraph Type="Dialogue"><Text>Keep the original brand.</Text></Paragraph></Content></FinalDraft>';
        const p=importScript(xml,'Original.fdx');validateUSS(p);
        let malformed=false;try{importScript('<FinalDraft><Content>','Broken.fdx');}catch(e){malformed=e.message.includes('valid XML');}
        return {scene:p.breakdowns[0].scene,text:p.breakdowns[0]._scriptText,cast:p.elements.filter(e=>p.categories.find(c=>c.id===e.category)?.ucid===100).map(e=>e.name),malformed};
        """, arguments: [:], in: nil, contentWorld: .page)
        let fields = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(fields["scene"] as? String, "42")
        XCTAssertEqual(fields["cast"] as? [String], ["MAYA"])
        XCTAssertTrue((fields["text"] as? String)?.contains("Keep the original brand.") == true)
        XCTAssertEqual(fields["malformed"] as? Bool, true)
    }

    @MainActor func testMobileGeometryNavigationAndRetainedDisclosureHandlers() async throws {
        let desk = try await openDesk()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let host = try XCTUnwrap(scene.windows.first(where: { $0.isKeyWindow })?.rootViewController)
        // Mount a real WKWebView so viewport media queries, hit testing and
        // animation frames run. Resize the child rather than faking CSS rules.
        host.addChild(desk)
        host.view.addSubview(desk.view)
        desk.didMove(toParent: host)
        defer {
            desk.willMove(toParent: nil)
            desk.view.removeFromSuperview()
            desk.removeFromParent()
        }
        desk.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        desk.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        _ = try await desk.webView.callAsyncJavaScript("""
        const $=s=>document.querySelector(s);
        $('#production-tools-toggle').click();$('#import-open').click();
        const field=$('#paste-script');
        field.value='INT. KITCHEN - DAY\\n\\nMAYA\\nThe kettle whistles.\\n\\nEXT. ROAD - NIGHT\\n\\nMAYA\\nThe car leaves.';
        field.dispatchEvent(new Event('input',{bubbles:true}));$('#import-submit').click();
        for(let i=0;i<100&&$('#modal').open;i++)await new Promise(r=>setTimeout(r,25));
        if($('#modal').open)throw Error($('#modal-error').textContent);
        return true;
        """, arguments: [:], in: nil, contentWorld: .page)

        for width in [320, 390] {
            desk.view.frame = CGRect(x: 0, y: 0, width: CGFloat(width), height: 844)
            desk.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
            let result = try await desk.webView.callAsyncJavaScript("""
            const $=s=>document.querySelector(s);
            const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const check=(value,message)=>{if(!value)throw Error(message+' at '+innerWidth+'px');};
            const rect=el=>el.getBoundingClientRect();
            check(Math.abs(innerWidth-expectedWidth)<2,'Actual WebKit viewport width');
            $('#navigation [data-view="workspace"]').click();await settle();
            const nav=$('#navigation'),buttons=[...nav.querySelectorAll('[data-view]')];
            check(buttons.length===5&&new Set(buttons.map(b=>b.dataset.view)).size===5,'Five unique navigation destinations');
            for(const button of buttons){const r=rect(button);check(r.width>=44&&r.height>=44,'Tappable '+button.dataset.view);check(r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'Unclipped navigation '+button.dataset.view);}
            check(nav.querySelectorAll('[aria-current="page"]').length===1,'One accessible current destination');
            check($('#production-tools-panel').hidden&&$('#import-open').getClientRects().length===0,'Collapsed tools hidden');
            $('#production-tools-toggle').click();await settle();
            check(!$('#production-tools-panel').hidden&&rect($('#import-open')).height>=44,'Expanded import command reachable');
            check($('#production-tools-toggle').getAttribute('aria-expanded')==='true','Expanded disclosure semantics');
            $('#production-tools-toggle').click();await settle();
            check(rect($('#script-text')).top<rect(nav).top-30,'Scene text enters first viewport');
            check(document.documentElement.scrollWidth<=innerWidth+1,'No horizontal page overflow');
            check($('#scene-search').getClientRects().length===0,'Search initially collapsed');
            $('#desk-search-toggle').click();await settle();
            check($('#desk-search-toggle').getAttribute('aria-expanded')==='true'&&rect($('#scene-search')).height>=44,'Search disclosure opens');
            $('#scene-search').value='ROAD';$('#scene-search').dispatchEvent(new Event('input',{bubbles:true}));await settle();
            check($('#scene-picker').options.length===1&&$('#scene-search').value==='ROAD','Original search handler still filters');
            $('#scene-search').value='';$('#scene-search').dispatchEvent(new Event('input',{bubbles:true}));await settle();
            $('#scene-search').blur();$('#desk-search-toggle').click();await settle();
            for(const button of buttons){button.click();await settle();check(nav.querySelectorAll('[aria-current="page"]').length===1,'Current selection after '+button.dataset.view);check(button.getAttribute('aria-current')==='page','Correct selected destination');check(document.documentElement.scrollWidth<=innerWidth+1,'Page overflow in '+button.dataset.view);}
            $('#navigation [data-view="workspace"]').click();await settle();
            return {width:innerWidth,navHeight:rect(nav).height,scriptTop:rect($('#script-text')).top};
            """, arguments: ["expectedWidth": width], in: nil, contentWorld: .page)
            let fields = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(fields["width"] as? Int, width)
        }

        _ = try await desk.webView.callAsyncJavaScript("""
        const $=s=>document.querySelector(s),settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const check=(value,message)=>{if(!value)throw Error(message);};
        $('#navigation [data-view="shots"]').click();await settle();
        check(!$('.desk-shot-filters').open,'Shot filters initially collapsed');
        $('#add-scene').click();$('#new-shot-description').value='Layout regression coverage';
        $('#new-shot-description').dispatchEvent(new Event('input',{bubbles:true}));$('#new-shot-save').click();await settle();
        $('.desk-shot-filters').open=true;await settle();
        $('#shot-status').value='Done';$('#shot-status').dispatchEvent(new Event('change',{bubbles:true}));await settle();
        check($('.desk-shot-filters').open&&$('#shot-status').value==='Done','Filter disclosure and status survive redraw');
        check($('#shot-count').textContent==='0 shots','Original status filter handler retained');
        $('#shot-status').value='all';$('#shot-status').dispatchEvent(new Event('change',{bubbles:true}));await settle();
        check($('#shot-count').textContent==='1 shots','Original filter handler restores planned shot');
        $('#navigation [data-view="workspace"]').click();$('#navigation [data-view="shots"]').click();await settle();
        check($('.desk-shot-filters').open,'Filter disclosure survives repeated navigation');
        $('#navigation [data-view="workspace"]').click();await settle();
        return await window.productionDeskSave();
        """, arguments: [:], in: nil, contentWorld: .page)

        desk.view.frame = CGRect(x: 0, y: 0, width: 1194, height: 900)
        desk.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        _ = try await desk.webView.callAsyncJavaScript("""
        const panels=[...document.querySelectorAll('.workspace > .panel')],r=panels.map(p=>p.getBoundingClientRect());
        if(innerWidth<1001||r.length<2||r[0].width<250||r[1].width<250||Math.abs(r[0].top-r[1].top)>1)throw Error('Wide tablet script/breakdown split has unusable geometry');
        if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Wide tablet page overflows');
        return true;
        """, arguments: [:], in: nil, contentWorld: .page)
    }

    @MainActor func testOptionalUSSCalendarAndHoldingBoardNormalizeBeforeNavigation() async throws {
        let desk = try await openDesk()
        let result = try await desk.webView.callAsyncJavaScript("""
        const {importScript}=await import('/film-native.js');
        const p=importScript('INT. STUDIO - DAY\\n\\nA quiet room.','Optional-calendar.txt');
        delete p.calendars[0].events;delete p.calendars[0].daysOff;
        p.stripboards[0].boards=p.stripboards[0].boards.slice(0,1);
        p.stripboards[0].boards[0].breakdownIds=[[p.breakdowns[0].id]];
        const $=s=>document.querySelector(s);
        $('#import-open').click();
        const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify({universalScheduleStandard:p})],'Optional-calendar.uss',{type:'application/json'}));
        $('#import-file').files=transfer.files;$('#import-submit').click();
        for(let i=0;i<100&&$('#modal').open;i++)await new Promise(r=>setTimeout(r,25));
        if($('#modal').open)throw Error($('#modal-error').textContent);
        $('#navigation [data-view="schedule"]').click();
        const day=document.querySelectorAll('.day-block').length;
        $('#settings-open').click();
        const settings=$('.modal-header h2').textContent;$('#modal-close').click();
        if(!await window.productionDeskSave())throw Error('Save did not finish');
        const w=await window.webkit.messageHandlers.scheduler.postMessage({operation:'load'});
        const loaded=w.projects.find(p=>p.id===w.activeProject);
        $('#app-settings-open').click();
        const cloudHidden=$('#gcasper-preview').closest('.settings-section').hidden&&$('#calendar-preview').closest('.settings-section').hidden;
        const previousTheme=localStorage.getItem('productionDeskTheme');
        $('[data-theme-choice="dark"]').click();
        return {day,settings,boards:loaded.stripboards[0].boards.length,events:loaded.calendars[0].events.length,daysOff:loaded.calendars[0].daysOff.length,cloudHidden,previousTheme};
        """, arguments: [:], in: nil, contentWorld: .page)
        let fields = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(fields["day"] as? Int, 1)
        XCTAssertEqual(fields["settings"] as? String, "Production settings")
        XCTAssertEqual(fields["boards"] as? Int, 2)
        XCTAssertEqual(fields["events"] as? Int, 0)
        XCTAssertEqual(fields["daysOff"] as? Int, 0)
        XCTAssertEqual(fields["cloudHidden"] as? Bool, true)
        let reopened = try await openDesk()
        let theme = try await reopened.webView.evaluateJavaScript("document.documentElement.dataset.theme")
        XCTAssertEqual(theme as? String, "dark")
        if let previous = fields["previousTheme"] as? String {
            _ = try await reopened.webView.callAsyncJavaScript("localStorage.setItem('productionDeskTheme',previous);", arguments: ["previous": previous], in: nil, contentWorld: .page)
        } else {
            _ = try await reopened.webView.evaluateJavaScript("localStorage.removeItem('productionDeskTheme')")
        }
    }
}
