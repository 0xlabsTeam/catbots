# Catbots — usability walkthrough / UX–UI review

วันที่ 6 กันยายน 2026 · โค้ด ac7ff41 · เว็บจริง http://127.0.0.1:5180/ ใช้ local backend  
ผู้ตรวจ: Codex · วิธี: expert walkthrough, browser interactions, screenshot inspection และตรวจ source  
นี่ไม่ใช่ usability test กับกลุ่มผู้ใช้จริง จึงไม่มีคะแนนความพึงพอใจหรืออัตราสำเร็จของผู้ใช้

## ผลหลัก

โครงสร้าง Kumo, การค้นหาบอต และการแยก Input/Output เริ่มใช้งานได้ แต่เส้นทางหลัก “เลือกตลาด → Run → เปลี่ยน Node เพื่อไล่ดูข้อมูล” ยังไม่ต่อเนื่อง และการเปลี่ยน Node ทำให้ค่าที่ยังไม่บันทึกหายได้ ควรแก้เรื่อง state ของ workspace ก่อนปรับความสวยงามเพิ่มเติม

ไม่ได้แก้ source ของผลิตภัณฑ์ในรอบตรวจนี้ รีเฟรช cache และรีสตาร์ต dev เพื่อปลดปัญหาหน้าขาวเท่านั้น ไม่มีการอนุมัติบอต เปิด deployment เปลี่ยน provider หรือบันทึก config ที่ใช้ทดสอบ

## Coverage

| หน้า/สถานะ | วิธีตรวจ | ข้อสังเกต |
|---|---|---|
| Bots | เปิดจริง desktop/mobile; ค้นหาที่ไม่พบ | ตารางเข้าใจได้; empty state และ Clear filters ชัด |
| Create bot | เปิด dialog; submit ชื่อว่าง; Escape | แสดง Enter a bot name; ไม่ได้สร้างบอตทดสอบเพิ่ม |
| Settings / AI providers | เปิดจริง desktop/mobile | active model กับ model selector ไม่ตรงกัน; compatible API ยังแสดงเต็มหน้า |
| Data | เปิดจริง | ยังเป็น placeholder |
| Activity | เปิดจริง | ยังเป็น placeholder |
| Nodes catalog | เปิดจริง | ปะปน package สำหรับ developer, simulation demos และ flow editor |
| Standalone flow editor | เปิดจริง desktop/tablet | กราฟเล็ก, 3 คอลัมน์กินพื้นที่, draft ผูก browser |
| Bot workbench | เปิดบอตจริง 3 รายการ | ครอบคลุม legacy approved, legacy draft, packaged flow |
| Flow + Inspector | คลิก Node จริง; แก้ชั่วคราวแต่ไม่ Save | พบ lost edits, market reset และผล Run หายเมื่อเปลี่ยน Node |
| Run node | รัน legacy interval, packaged tick และ EMA | tick/EMA รับข้อมูล mainnet; legacy interval skipped |
| Backtest | เปิดผลเก่าจริงและ empty/unsupported state | ไม่ได้สั่ง backtest ใหม่; packaged flow ยังใช้ไม่ได้ |
| Performance / Logs | เปิดจริงทั้ง 3 บอต | แสดง unavailable/empty state; ซ้ำกับ runtime footer |
| Dark mode | ตรวจ workbench ที่ 1440px | โครงสร้างคงเดิม แต่ Node ที่ย่อยังอ่านยาก |
| Responsive | 1440×1000, 768×900, 390×844 | ไม่มี document overflow ใน snapshots แต่มีเนื้อหาภายในถูกตัด/ซ่อน |
| First launch / config repair | ตรวจ source เท่านั้น | ใช้ Settings ร่วมกัน; first launch ยังวาง provider กับ setup ต่อกัน |
| Database repair | ตรวจ source เท่านั้น | มีเพียงคำอธิบายและ Quit; ไม่มีขั้นตอนซ่อมหรือช่องทางช่วยเหลือ |
| Paper review / Live review | ตรวจ source เท่านั้น | มี risk form / preflight / confirm; ไม่ได้เปลี่ยน approval เพื่อเปิดหน้าหรือเริ่ม deployment |
| Native desktop | ไม่ได้ทำ interaction audit แยก | renderer ร่วมกับเว็บ ไม่ถือเป็นหลักฐานว่า desktop ผ่านทั้งหมด |
| OAuth login, AI streaming, install package | ไม่ได้เริ่มงานใหม่ | ตรวจ UI/state/source เท่านั้น ไม่ได้เปลี่ยนบัญชีหรือส่ง prompt เพิ่ม |

## Findings เรียงลำดับความสำคัญ

### P1 — แก้ก่อนใช้งานต่อเนื่อง

1. **เปลี่ยน Node แล้วค่าที่แก้หายโดยไม่มีคำเตือน**
   - ทดลอง EMA period 14 → 15 โดยไม่ Save → คลิก EMA อีกตัว → กลับมา ได้ 14 และไม่มี Unsaved changes
   - สาเหตุ: NodeConfiguration เก็บ config ใน local state และถูก remount ด้วย key nodeId/version
   - ข้อเสนอ: เก็บ draft config ต่อ node ใน workspace; คงค่าไว้เมื่อสลับ selection; ก่อนออกจาก workspace ให้เลือก Save/Discard
   - เกณฑ์ผ่าน: สลับ Node หรือปิด inspector ไม่ทำให้ค่าที่พิมพ์สูญหาย
   - หลักฐาน: interaction-results.json; ChatFlowGraph.tsx:59

2. **ตลาดที่เลือกไม่ใช่ context ร่วมของการ Run**
   - เลือก SOL-PERP แล้ว Run EMA → คลิก EMA อีกตัว ช่อง Market กลับเป็น ETH-PERP
   - ผู้ใช้ไล่ดู Node เดียวกันใน Flow แต่เสี่ยงทดสอบคนละตลาดโดยไม่ตั้งใจ; chat ของบอตระบุ SOL-PERP ด้วย
   - ข้อเสนอ: ย้าย Market ไป toolbar ระดับ workflow และเก็บเป็น run context; ทุก Node ใช้ market/run ID เดียวกัน
   - เกณฑ์ผ่าน: ทุกผลในหนึ่ง run แสดงตลาดและเวลาตรงกัน; ไม่มี default reset เมื่อเปลี่ยน selection
   - หลักฐาน: interaction-results.json; NodeConfiguration.tsx:13

3. **Run สำเร็จแล้วกลับมาดูผลเดิมไม่ได้**
   - Run EMA สำเร็จ มี mainnet provenance → เปลี่ยน Node → กลับมา Data & debug กลายเป็น Not evaluated
   - จึงไล่เส้นข้อมูลแบบ n8n ไม่ได้ ต้อง fetch และคำนวณใหม่ ซึ่งอาจได้ข้อมูลคนละเวลา
   - ข้อเสนอ: เก็บ trace ต่อ run ที่ workspace และส่ง selected trace ให้ inspector; แสดง stale เมื่อ graph/config เปลี่ยน
   - เกณฑ์ผ่าน: คลิกต้นทางทุกตัวของ run แล้วดู Input/Output จาก snapshot เดิมได้
   - หลักฐาน: 30-ema-run.png, 31-run-result-lost.png

4. **Run Interval รุ่นเดิมแทบไม่เคย activate**
   - ปุ่ม Run ใช้ fetchedAt ที่มีมิลลิวินาที แล้วตรวจหารลงตัวกับรอบ 1 ชั่วโมง; พบ activation:false ทั้งสองบอต
   - ปุ่มสื่อว่ารันเพื่อทดสอบ แต่ implementation ทดสอบว่า “เวลาปัจจุบันตรง schedule หรือไม่”
   - ข้อเสนอ: แยก Manual run กับ Schedule evaluation; manual activation ต้องมี provenance ว่าถูก inject โดยผู้ใช้
   - เกณฑ์ผ่าน: Manual Run ได้ข้อมูลปลายทางโดยไม่ต้องกดตรงขอบชั่วโมง; scheduled run ยังคงกติกาเดิม
   - หลักฐาน: 23-run-0.png; legacy-node-run.ts:19

5. **กราฟอ่านไม่ออกที่ zoom เริ่มต้น และแย่ลงเมื่อเปิด Inspector**
   - ที่ 1440px: sidebar ~240px + chat ~400px + inspector ~320px เหลือพื้นที่กราฟ ~480px
   - Fit flow ย่อทั้งกราฟจนข้อความใน Node เล็กมาก แม้มีพื้นที่ว่างแนวตั้งจำนวนมาก
   - ข้อเสนอ: collapse rail/chat อัตโนมัติแบบที่ผู้ใช้ควบคุมได้, inspector แบบ resizable/overlay, Fit selection และ 100% ที่เข้าถึงง่าย; ไม่ auto-fit ทุก edge update ระหว่างที่ผู้ใช้กำลังอ่าน
   - เกณฑ์ผ่าน: คลิก Node แล้วอ่านชื่อ/ค่าหลักได้โดยไม่ต้อง zoom ซ้ำ; การเลือกไม่ทำให้กล้องกระโดด
   - หลักฐาน: 20-workbench-2.png, 22-inspector-2.png, 08-flow-editor.png

### P2 — ลดความสับสนและปรับ hierarchy

6. **Settings มี configuration provider สองชุดที่ดู active พร้อมกัน**
   - Active badge ระบุ Codex/model แต่ selector ยังเป็น Choose a model; compatible API form ใหญ่ยังอยู่ด้านล่างพร้อมค่าเดิม
   - ข้อเสนอ: ใช้ mode Subscription / API key ที่ชัด; populate model ที่เลือกจริง; ยุบ inactive form; แยก Profile/Execution settings
   - หลักฐาน: 04-settings.png, 14-settings-mobile.png; ProviderConnections.tsx:9

7. **สถานะ/คำศัพท์ไม่สอดคล้องกับความสามารถ**
   - Nodes catalog บอก Simulation only, editor ใช้ real market, debugger ยังมี Reset simulation/Run a snapshot
   - Packaged Backtest เป็น tab ปกติแต่พาไปหน้าที่ใช้ไม่ได้; header Draft + Flow Building ไม่บอกว่าจะทำให้ valid อย่างไรด้วย UI
   - ข้อเสนอ: แยก Data source, Validation status, Execution mode; ป้าย unavailable บน tab; เพิ่ม Validate flow และเหตุผลที่ยังไม่ผ่าน
   - หลักฐาน: 07-nodes.png, 08-flow-editor.png, 21-2-backtest.png

8. **Input/Output เน้น JSON ยาวแทนคำตอบที่ trader ต้องใช้**
   - EMA input มีแท่งเทียนหลายร้อยรายการ; output อยู่ต่ำลงไปใน inspector แคบ; timestamp เป็น ISO ยาว
   - ข้อเสนอ: สรุป “200 closed candles · 4h · last close …”; แสดง output value ก่อน; table/JSON toggle; หน่วยและเวลาท้องถิ่นพร้อม UTC ในรายละเอียด
   - หลักฐาน: 30-ema-run.png; NodeConfiguration.tsx:62–68

9. **Draft อยู่คนละที่และมีพฤติกรรมบันทึกต่างกัน**
   - Standalone editor เก็บ browser localStorage; chat graph เก็บ backend; ไม่มีขั้นตอนนำ standalone draft เข้า bot ใน UI
   - ข้อเสนอ: ให้ editor เป็นส่วนหนึ่งของ bot หรือใช้ชื่อ Sandbox และมี Import into bot ที่ชัดเจน; แสดง saved location
   - หลักฐาน: 08-flow-editor.png; PackageNodeExample.tsx:85

10. **Data / Activity เป็นทางตัน**
    - Navigation มีน้ำหนักเท่าหน้าพร้อมใช้ แต่เปิดได้เพียงข้อความ later milestone
    - ข้อเสนอ: ป้าย Coming soon หรือแสดงข้อมูลที่มีแล้ว เช่น mainnet source status และ node execution history
    - หลักฐาน: 05-data.png, 06-activity.png; App.tsx:61–62

11. **Mobile/tablet navigation และ canvas ยังไม่เหมาะกับงาน**
    - 390px: Settings อยู่นอกแถบแรก ต้องเลื่อน nav; บาง tab ถูกตัดและไม่ชัดว่าเลื่อนได้
    - 768px: sidebar กินพื้นที่ ~240px และ palette เหลือ canvas แคบ
    - ข้อเสนอ: mobile overflow menu/bottom navigation, toggle Chat/Flow/Inspector ทีละ pane; tablet ยุบ sidebar ก่อน
    - หลักฐาน: 09-editor-tablet.png, 13-bots-mobile.png, 24-workbench-mobile.png
    - ไม่มี document horizontal overflow ไม่ได้แปลว่า content ภายในทุก pane มองเห็นครบ

12. **Backtest แยก “ค่าที่จะรัน” กับ “ผล run ที่เลือก” ไม่ชัด**
    - From/To ของฟอร์ม, ช่วงเวลาผล และ dataset coverage แสดงคนละช่วง/รูปแบบวันที่; fee/slippage row เบียดพื้นที่ด้านขวา
    - ข้อเสนอ: แยก New run settings และ Selected run results; ใช้รูปแบบวันที่เดียว; แสดง coverage ข้าง date fields และให้ apply range
    - หลักฐาน: 21-0-backtest.png; ตรวจเฉพาะผลที่มีอยู่ ไม่ได้ยืนยัน error path ของ run ใหม่

13. **Empty/recovery state ไม่บอกขั้นตอนที่ทำต่อได้ชัด**
    - Performance กับ footer ซ้ำ Paper runtime unavailable; Logs บอกไม่มี recorded logs ทั้งที่ footer บอก logs remain available
    - Database repair บอกให้ repair เองแต่ไม่มีคำแนะนำ; transport error ตอน bootstrap ถูกตีความเป็น repair state จาก source
    - ข้อเสนอ: แยก Offline / Runtime not restored / No historical events / Corrupt storage; CTA Retry, View saved run หรือ Open recovery guide ตามสาเหตุ
    - หลักฐาน: 21-0-performance.png, 21-0-logs.png; DatabaseRepairScreen.tsx; App.tsx:29–34

## Development reliability

ตอนเริ่ม audit เว็บเป็นหน้าขาว โดย browser error ระบุ missing export matchesEventTrigger จาก node-inspection.ts ทั้งที่ source มี export แล้ว หลังนำ Vite cache ออกไปเก็บใน /tmp และรีสตาร์ต dev หน้าเปิดได้ ไม่มี pageerror ใน walkthrough รอบถัดไป

เป็นปัญหา dev cache ที่พบจริงในเครื่องนี้ ยังไม่มีหลักฐานว่า production build มีปัญหาเดียวกัน ควรมี startup error/retry UI และ smoke test เปิดหน้าเว็บหลังเพิ่ม workspace package export; ไม่ใช้แค่ tsc เป็นหลักฐานว่า UI เปิดได้

## จุดที่ทำงานดี

- Bots: Search, no matching bots และ Clear filters มีทางกลับชัด
- Create bot: ชื่อว่างแสดง error ตรง field; Escape ออกจาก dialog ได้
- Mainnet Run: tick และ EMA แสดง source/market/fetchedAt; EMA ของ SOL ประมวลผลต้นทาง 3 nodes ได้
- Run ไม่ dispatch คำสั่งซื้อขาย; unavailable data ไม่ถูกแทนด้วยยอดบัญชีปลอม
- Kumo controls และ spacing ของหน้ารายการ/Settings มีพื้นฐานสม่ำเสมอ
- สี Node มี icon/category label ประกอบ จึงไม่พึ่งสีเพียงอย่างเดียว
- Dark mode รักษา hierarchy หลักได้ แต่ไม่ได้วัด contrast ratio จึงยังไม่สรุป WCAG pass

## รอบ usability test กับ trader ที่แนะนำ

ให้ trader ที่ไม่เคยใช้ 5 คนทำงานเดียวกัน โดยไม่บอกตำแหน่งปุ่ม:
1. หา/เปิด bot และอธิบายว่ากำลังใช้ตลาดอะไร
2. แก้ EMA period แล้วไปดูอีก Node ก่อนกลับมา Save
3. Run บน SOL แล้วตามดู candles → EMA → Compare จาก run เดียวกัน
4. อธิบายความต่างของ data unavailable, condition false และ skipped
5. บอกว่า Backtest ใช้ข้อมูลอะไร และตอนนี้ส่งคำสั่งเงินจริงหรือไม่
6. เลือก provider/model ที่จะใช้ chat และยืนยันว่า active ตัวไหน

บันทึก completion, wrong-market runs, lost edits, จำนวนครั้งที่ต้องขอความช่วยเหลือ และเวลาจนพบ output โดยยังไม่กำหนดผลลัพธ์ล่วงหน้า

## หลักฐาน

- observations.json: หน้าหลัก, responsive, ขนาด viewport/document และปุ่ม
- workbench-observations.json: 3 บอตและทุก tab
- interaction-results.json: lost edits, market reset, lost output และ form validation
- PNG ในโฟลเดอร์เดียวกัน: screenshots ที่ระบุใน findings
