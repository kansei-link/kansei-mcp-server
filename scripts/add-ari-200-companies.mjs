#!/usr/bin/env node
/**
 * Add 141 new Japanese SaaS companies to services-seed.json
 * for ARI Award 2026 Summer (200-company verification).
 *
 * Usage: node scripts/add-ari-200-companies.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', 'src', 'data', 'services-seed.json');

const NEW_SERVICES = [
  // ── 会計・経理・請求書 ──
  { id: "bill-one", name: "Bill One", category: "accounting", description: "Invoice management SaaS by Sansan. Digitizes and centralizes all types of invoices. REST API available.", tags: "accounting,invoice,digitization,japanese,jp-native", api_url: "https://bill-one.com/", api_auth_method: "api_key" },
  { id: "rakuraku-meisai", name: "楽楽明細", category: "accounting", description: "Electronic invoice and statement delivery platform by Rakus. Automates sending of invoices, statements, and payment notices.", tags: "accounting,invoice,delivery,electronic,japanese,jp-native", api_url: "https://www.rakurakumeisai.jp/", api_auth_method: "unknown" },
  { id: "streamed", name: "STREAMED", category: "accounting", description: "AI-powered bookkeeping automation by MoneyForward. Scans receipts and auto-generates journal entries.", tags: "accounting,bookkeeping,ai,ocr,receipt,japanese,jp-native", api_url: "https://streamedup.com/", api_auth_method: "unknown" },
  { id: "tokium", name: "TOKIUM", category: "accounting", description: "Expense management and invoice processing platform. AI-powered receipt scanning and approval workflows.", tags: "accounting,expense,invoice,ai,japanese,jp-native", api_url: "https://www.keihi.com/", api_auth_method: "unknown" },
  { id: "crew", name: "Crew", category: "accounting", description: "Cloud-based accounting software for small businesses in Japan.", tags: "accounting,small-business,japanese,jp-native", api_url: "https://crew-expenses.com/", api_auth_method: "unknown" },
  { id: "a-saas", name: "A-SaaS", category: "accounting", description: "Cloud accounting platform for tax accountants (税理士). All-in-one professional accounting suite.", tags: "accounting,tax-accountant,professional,japanese,jp-native", api_url: "https://www.a-saas.com/", api_auth_method: "unknown" },
  { id: "tkc", name: "TKC Cloud", category: "accounting", description: "Japan's largest tax accountant network providing cloud accounting (FX/e21まいスター). Deep integration with tax filing.", tags: "accounting,tax-accountant,tax-filing,enterprise,japanese,jp-native", api_url: "https://www.tkc.jp/", api_auth_method: "unknown" },
  { id: "mjs", name: "MJS会計大将", category: "accounting", description: "Enterprise accounting system by Miroku Jyoho Service. Mid-to-large company accounting with consolidated reporting.", tags: "accounting,enterprise,consolidated,japanese,jp-native", api_url: "https://www.mjs.co.jp/", api_auth_method: "unknown" },
  { id: "bugyo-kaikei", name: "勘定奉行クラウド", category: "accounting", description: "Cloud accounting by OBC (Obic Business Consultants). Long-established mid-market accounting platform with API.", tags: "accounting,mid-market,enterprise,japanese,jp-native", api_url: "https://www.obc.co.jp/bugyo-cloud/kanjo", api_auth_method: "unknown" },
  { id: "pca-cloud", name: "PCAクラウド会計", category: "accounting", description: "Cloud accounting by PCA Corp. Mid-market accounting with strong back-office integration.", tags: "accounting,mid-market,japanese,jp-native", api_url: "https://pca.jp/", api_auth_method: "unknown" },
  { id: "sweeep", name: "sweeep", category: "accounting", description: "AI invoice processing platform. Auto-reads invoices and generates journal entries with AI.", tags: "accounting,invoice,ai,automation,japanese,jp-native", api_url: "https://sweeep.ai/", api_auth_method: "unknown" },
  { id: "staple", name: "Staple", category: "accounting", description: "Corporate card and expense management by CloudCast. Prepaid corporate cards with real-time expense tracking.", tags: "accounting,expense,corporate-card,japanese,jp-native", api_url: "https://staple.jp/", api_auth_method: "unknown" },

  // ── 人事・労務・勤怠・給与 ──
  { id: "jinjer", name: "ジンジャー", category: "hr", description: "All-in-one HR platform by jinjer, Inc. Covers attendance, payroll, HR, workflow, and e-sign.", tags: "hr,attendance,payroll,workflow,japanese,jp-native", api_url: "https://jinjer.biz/", api_auth_method: "unknown" },
  { id: "hrbrain", name: "HRBrain", category: "hr", description: "Talent management platform. Employee evaluation, engagement surveys, and skill management.", tags: "hr,talent-management,evaluation,engagement,japanese,jp-native", api_url: "https://www.hrbrain.jp/", api_auth_method: "unknown" },
  { id: "wevox", name: "Wevox", category: "hr", description: "Employee engagement platform by Atrae. Pulse surveys and organizational analytics.", tags: "hr,engagement,survey,analytics,japanese,jp-native", api_url: "https://wevox.io/", api_auth_method: "unknown" },
  { id: "cydas", name: "CYDAS", category: "hr", description: "Talent management and HR analytics platform. Skills visualization, career development, and succession planning.", tags: "hr,talent-management,analytics,skills,japanese,jp-native", api_url: "https://www.cydas.com/", api_auth_method: "unknown" },
  { id: "talent-palette", name: "タレントパレット", category: "hr", description: "Talent management platform by Plus Alpha Consulting. AI-driven employee analytics and optimal placement.", tags: "hr,talent-management,ai,analytics,japanese,jp-native", api_url: "https://www.talent-palette.com/", api_auth_method: "unknown" },
  { id: "bugyo-kyuyo", name: "給与奉行クラウド", category: "hr", description: "Cloud payroll by OBC. Payroll calculation, year-end adjustment, and social insurance processing.", tags: "hr,payroll,year-end,social-insurance,japanese,jp-native", api_url: "https://www.obc.co.jp/bugyo-cloud/kyuyo", api_auth_method: "unknown" },
  { id: "rakuraku-kintai", name: "楽楽勤怠", category: "hr", description: "Attendance management by Rakus. Easy time-clock with shift management and overtime alerts.", tags: "hr,attendance,shift,japanese,jp-native", api_url: "https://www.rakurakukintai.jp/", api_auth_method: "unknown" },
  { id: "minagine", name: "MINAGINE勤怠管理", category: "hr", description: "Attendance management focused on labor compliance. Overtime alerts and 36-agreement management.", tags: "hr,attendance,compliance,labor-law,japanese,jp-native", api_url: "https://minagine.jp/", api_auth_method: "unknown" },
  { id: "akashi", name: "AKASHI", category: "hr", description: "Cloud attendance management by Sony Biz Networks. Multi-device time-clock with flexible work support.", tags: "hr,attendance,sony,japanese,jp-native", api_url: "https://ak4.jp/", api_auth_method: "unknown" },
  { id: "recoru", name: "レコル", category: "hr", description: "Simple attendance management system. Low-cost time-clock solution for SMBs.", tags: "hr,attendance,smb,japanese,jp-native", api_url: "https://www.recoru.in/", api_auth_method: "unknown" },
  { id: "herp", name: "HERP Hire", category: "hr", description: "Collaborative hiring platform. ATS with scrum-style hiring and multi-channel sourcing.", tags: "hr,ats,hiring,recruiting,japanese,jp-native", api_url: "https://herp.cloud/", api_auth_method: "unknown" },
  { id: "harutaka", name: "harutaka", category: "hr", description: "AI interview platform by ZENKIGEN. Video interviews with AI-powered evaluation support.", tags: "hr,interview,ai,video,japanese,jp-native", api_url: "https://harutaka.jp/", api_auth_method: "unknown" },
  { id: "sonar-ats", name: "SONAR ATS", category: "hr", description: "Applicant tracking system by Thinkings. Unified new-grad and mid-career hiring management.", tags: "hr,ats,hiring,japanese,jp-native", api_url: "https://sonar-ats.jp/", api_auth_method: "unknown" },
  { id: "mfcloud-kyuyo", name: "マネーフォワード クラウド給与", category: "hr", description: "Cloud payroll by MoneyForward. Integrated with MF Cloud HR and accounting.", tags: "hr,payroll,moneyforward,japanese,jp-native", api_url: "https://biz.moneyforward.com/payroll/", api_auth_method: "unknown" },
  { id: "freee-kyuyo", name: "freee給与計算", category: "hr", description: "Payroll calculation within freee HR suite. Integrated with freee accounting for seamless journal entries.", tags: "hr,payroll,freee,japanese,jp-native", api_url: "https://www.freee.co.jp/hr/", api_auth_method: "oauth2" },

  // ── コミュニケーション・グループウェア ──
  { id: "typetalk", name: "Typetalk", category: "communication", description: "Business chat by Nulab. Team messaging integrated with Backlog and Cacoo.", tags: "communication,chat,nulab,japanese,jp-native", api_url: "https://developer.nulab.com/docs/typetalk/", api_auth_method: "oauth2" },
  { id: "wowtalk", name: "WowTalk", category: "communication", description: "Enterprise business chat. Security-focused messaging with admin controls for regulated industries.", tags: "communication,chat,enterprise,security,japanese,jp-native", api_url: "https://www.wowtalk.jp/", api_auth_method: "unknown" },
  { id: "elgana", name: "elgana", category: "communication", description: "Business chat by NTT Communications. Secure messaging for enterprise with NTT infrastructure.", tags: "communication,chat,ntt,enterprise,japanese,jp-native", api_url: "https://elgana.jp/", api_auth_method: "unknown" },
  { id: "direct", name: "direct", category: "communication", description: "Business chat by L is B. Field-work oriented messaging with chatbot integration.", tags: "communication,chat,field-work,chatbot,japanese,jp-native", api_url: "https://direct4b.com/", api_auth_method: "unknown" },
  { id: "tocaro", name: "Tocaro", category: "communication", description: "Business collaboration tool. Messaging with task management and file sharing.", tags: "communication,chat,task,collaboration,japanese,jp-native", api_url: "https://tocaro.im/", api_auth_method: "unknown" },
  { id: "cybozu-office", name: "サイボウズ Office", category: "communication", description: "Groupware by Cybozu for SMBs. Schedule, bulletin board, workflow, file management.", tags: "communication,groupware,cybozu,smb,japanese,jp-native", api_url: "https://office.cybozu.co.jp/", api_auth_method: "unknown" },
  { id: "desknet-neo", name: "desknet's NEO", category: "communication", description: "Groupware by Neo Japan. 27 built-in apps including schedule, workflow, and webmail.", tags: "communication,groupware,enterprise,japanese,jp-native", api_url: "https://www.desknets.com/", api_auth_method: "unknown" },
  { id: "aipo", name: "Aipo", category: "communication", description: "Schedule and facility management groupware by TOWN. Simple shared calendar for teams.", tags: "communication,groupware,schedule,japanese,jp-native", api_url: "https://aipo.com/", api_auth_method: "unknown" },
  { id: "gridy", name: "GRIDY", category: "communication", description: "Free groupware by Brand Dialog. Basic groupware features including scheduler and BBS.", tags: "communication,groupware,free,japanese,jp-native", api_url: "https://gridy.jp/", api_auth_method: "unknown" },

  // ── 契約・リーガル ──
  { id: "hubble", name: "Hubble", category: "legal", description: "Contract management platform. Version control for contracts with diff-tracking and Word integration.", tags: "legal,contract,version-control,japanese,jp-native", api_url: "https://hubble-docs.com/", api_auth_method: "unknown" },
  { id: "contracts", name: "ContractS", category: "legal", description: "Contract lifecycle management by ContractS. Contract creation, review, approval, and storage.", tags: "legal,contract,lifecycle,japanese,jp-native", api_url: "https://www.contracts.co.jp/", api_auth_method: "unknown" },
  { id: "ninja-sign", name: "freeeサイン Light", category: "legal", description: "Electronic signature service (formerly Ninja Sign). Simple e-sign for SMBs.", tags: "legal,e-sign,smb,freee,japanese,jp-native", api_url: "https://sign.freee.co.jp/", api_auth_method: "unknown" },
  { id: "docusign-jp", name: "DocuSign Japan", category: "legal", description: "Global e-signature platform with Japan operations. REST API with extensive documentation.", tags: "legal,e-sign,global,japanese", api_url: "https://developers.docusign.com/", api_auth_method: "oauth2" },
  { id: "contract-one", name: "Contract One", category: "legal", description: "Contract management by Sansan. AI-powered contract digitization and centralized management.", tags: "legal,contract,ai,sansan,japanese,jp-native", api_url: "https://contract-one.com/", api_auth_method: "unknown" },
  { id: "manage-ozan", name: "マネジメントオーザン", category: "legal", description: "Legal operations management platform for corporate legal departments.", tags: "legal,legal-ops,enterprise,japanese,jp-native", api_url: "https://managementozan.com/", api_auth_method: "unknown" },

  // ── 決済・POS・フィンテック ──
  { id: "fincode", name: "fincode byGMO", category: "payment", description: "Developer-friendly payment platform by GMO. Simple API for card payments, convenience store payments.", tags: "payment,developer,gmo,japanese,jp-native", api_url: "https://docs.fincode.jp/", api_auth_method: "api_key" },
  { id: "komoju", name: "KOMOJU", category: "payment", description: "Multi-payment gateway by Degica. Supports Japanese payment methods (konbini, bank transfer, carrier billing).", tags: "payment,gateway,multi-method,japanese,jp-native", api_url: "https://docs.komoju.com/", api_auth_method: "api_key" },
  { id: "robot-payment", name: "Robot Payment", category: "payment", description: "Recurring billing and payment platform. Subscription management and invoice automation.", tags: "payment,recurring,subscription,billing,japanese,jp-native", api_url: "https://www.robotpayment.co.jp/", api_auth_method: "unknown" },
  { id: "airpay", name: "Airペイ", category: "payment", description: "Multi-payment terminal by Recruit. POS and payment acceptance for physical stores.", tags: "payment,pos,terminal,recruit,japanese,jp-native", api_url: "https://airregi.jp/payment/", api_auth_method: "unknown" },
  { id: "storesjp-pay", name: "STORES 決済", category: "payment", description: "Mobile payment acceptance by STORES (formerly Coiney). Simple card reader for SMB retail.", tags: "payment,mobile,smb,stores,japanese,jp-native", api_url: "https://stores.jp/payments", api_auth_method: "unknown" },
  { id: "univapay", name: "UnivaPay", category: "payment", description: "Payment gateway with strong multi-currency support. Popular for inbound tourism payments.", tags: "payment,gateway,multi-currency,inbound,japanese,jp-native", api_url: "https://www.univapay.com/", api_auth_method: "api_key" },
  { id: "epsilon", name: "イプシロン", category: "payment", description: "Online payment service by GMO Epsilon. Long-established gateway for EC sites.", tags: "payment,gateway,ec,gmo,japanese,jp-native", api_url: "https://www.epsilon.jp/", api_auth_method: "unknown" },
  { id: "sbpayment", name: "SBペイメントサービス", category: "payment", description: "Payment service by SoftBank Group. Carrier billing and multi-payment for digital content.", tags: "payment,carrier-billing,softbank,japanese,jp-native", api_url: "https://www.sbpayment.jp/", api_auth_method: "unknown" },

  // ── CRM・SFA・営業支援 ──
  { id: "mazrica", name: "Mazrica Sales", category: "crm", description: "AI-powered SFA (formerly Senses). Deal management with AI forecasting and activity capture.", tags: "crm,sfa,ai,deal-management,japanese,jp-native", api_url: "https://product-senses.mazrica.com/", api_auth_method: "unknown" },
  { id: "e-sales-manager", name: "eセールスマネージャー", category: "crm", description: "SFA/CRM by Softbrain. Japan's leading SFA with extensive customization for Japanese sales culture.", tags: "crm,sfa,japanese-sales,enterprise,japanese,jp-native", api_url: "https://www.e-sales.jp/", api_auth_method: "unknown" },
  { id: "geniee-sfa", name: "GENIEE SFA/CRM", category: "crm", description: "SFA/CRM by GENIEE. Cost-effective CRM with MA integration for SMBs.", tags: "crm,sfa,smb,japanese,jp-native", api_url: "https://chikyu.net/", api_auth_method: "unknown" },
  { id: "knowledge-suite", name: "Knowledge Suite", category: "crm", description: "SFA/CRM/groupware by BlueTec. All-in-one business platform with SFA, groupware, and analytics.", tags: "crm,sfa,groupware,japanese,jp-native", api_url: "https://www.knowledge-suite.jp/", api_auth_method: "unknown" },
  { id: "zoho-crm-jp", name: "Zoho CRM Japan", category: "crm", description: "Zoho CRM with Japan localization and support. Full REST API with extensive developer documentation.", tags: "crm,global,japanese", api_url: "https://www.zoho.com/jp/crm/developer/", api_auth_method: "oauth2" },
  { id: "cyzen", name: "cyzen", category: "crm", description: "Field sales support by Red Fox. GPS-based visit management and activity reporting for field reps.", tags: "crm,field-sales,gps,mobile,japanese,jp-native", api_url: "https://www.cyzen.cloud/", api_auth_method: "unknown" },
  { id: "hot-profile", name: "HotProfile", category: "crm", description: "Business card management and SFA by Hammock. Card scanning, CRM, and MA in one platform.", tags: "crm,business-card,sfa,ma,japanese,jp-native", api_url: "https://www.hammock.jp/hpr/", api_auth_method: "unknown" },
  { id: "bell-face", name: "bellFace", category: "crm", description: "Online sales platform. Video conferencing designed specifically for B2B sales conversations.", tags: "crm,video,online-sales,b2b,japanese,jp-native", api_url: "https://bell-face.com/", api_auth_method: "unknown" },
  { id: "upward", name: "UPWARD", category: "crm", description: "Field sales DX platform. Map-based customer management and visit optimization for field reps.", tags: "crm,field-sales,map,dx,japanese,jp-native", api_url: "https://www.upward.jp/", api_auth_method: "unknown" },

  // ── マーケティング・MA・広告 ──
  { id: "shanon", name: "SHANON Marketing Platform", category: "marketing", description: "Marketing automation platform by SHANON. Event management, lead scoring, and email marketing.", tags: "marketing,ma,event,lead-scoring,japanese,jp-native", api_url: "https://www.shanon.co.jp/", api_auth_method: "unknown" },
  { id: "repro", name: "Repro", category: "marketing", description: "Customer engagement platform. Push notifications, in-app messaging, and web personalization.", tags: "marketing,engagement,push,personalization,japanese,jp-native", api_url: "https://repro.io/", api_auth_method: "api_key" },
  { id: "sprocket", name: "Sprocket", category: "marketing", description: "Web customer experience platform. Pop-up optimization and guided navigation for conversion.", tags: "marketing,cx,popup,conversion,japanese,jp-native", api_url: "https://www.sprocket.bz/", api_auth_method: "unknown" },
  { id: "line-oa", name: "LINE公式アカウント API", category: "marketing", description: "LINE Official Account management API. Messaging, rich menus, and audience management for business accounts.", tags: "marketing,line,messaging,crm,japanese,jp-native", api_url: "https://developers.line.biz/ja/docs/messaging-api/", api_auth_method: "bearer_token" },
  { id: "liny", name: "Liny", category: "marketing", description: "LINE marketing automation by Social DataBank. Segment management and step delivery for LINE OA.", tags: "marketing,line,ma,automation,japanese,jp-native", api_url: "https://line-sm.com/", api_auth_method: "unknown" },
  { id: "kaizen-platform", name: "Kaizen Platform", category: "marketing", description: "DX platform for growth. A/B testing, UX improvement, and video production.", tags: "marketing,ab-test,ux,dx,japanese,jp-native", api_url: "https://kaizenplatform.com/", api_auth_method: "unknown" },
  { id: "plaid", name: "PLAID", category: "marketing", description: "CX platform (operator of KARTE). Real-time customer analytics and personalization engine.", tags: "marketing,cx,analytics,personalization,japanese,jp-native", api_url: "https://plaid.co.jp/", api_auth_method: "unknown" },
  { id: "logly", name: "Logly Lift", category: "marketing", description: "Native ad platform by Logly. Content recommendation and native advertising network.", tags: "marketing,native-ad,content,recommendation,japanese,jp-native", api_url: "https://www.logly.co.jp/", api_auth_method: "unknown" },
  { id: "ferret-one", name: "ferret One", category: "marketing", description: "BtoB marketing platform by Basic. CMS, MA, and LP creation for lead generation.", tags: "marketing,btob,cms,ma,lead-gen,japanese,jp-native", api_url: "https://ferret-one.com/", api_auth_method: "unknown" },
  { id: "yappli", name: "Yappli", category: "marketing", description: "No-code mobile app development platform. App creation, CRM, and push notification for brands.", tags: "marketing,mobile-app,no-code,crm,japanese,jp-native", api_url: "https://yapp.li/", api_auth_method: "unknown" },

  // ── EC・コマース ──
  { id: "futureshop", name: "futureshop", category: "ecommerce", description: "Enterprise EC platform. Feature-rich e-commerce with omnichannel and CRM capabilities.", tags: "ecommerce,enterprise,omnichannel,japanese,jp-native", api_url: "https://www.future-shop.jp/", api_auth_method: "unknown" },
  { id: "makeshop", name: "MakeShop", category: "ecommerce", description: "EC platform by GMO MakeShop. Feature-rich online store builder with 651+ functions.", tags: "ecommerce,store-builder,gmo,japanese,jp-native", api_url: "https://www.makeshop.jp/", api_auth_method: "api_key" },
  { id: "next-engine", name: "ネクストエンジン", category: "ecommerce", description: "EC back-office automation by Hamee. Multi-channel order/inventory management for EC operators.", tags: "ecommerce,order-management,inventory,multi-channel,japanese,jp-native", api_url: "https://developer.next-engine.com/", api_auth_method: "oauth2" },
  { id: "cross-mall", name: "CROSS MALL", category: "ecommerce", description: "Multi-channel EC management by i-lle. Centralized inventory and order management across marketplaces.", tags: "ecommerce,multi-channel,inventory,marketplace,japanese,jp-native", api_url: "https://cross-mall.jp/", api_auth_method: "unknown" },
  { id: "shopserve", name: "Shopserve", category: "ecommerce", description: "EC platform by E-Store. Long-established online store platform with full commerce features.", tags: "ecommerce,store-builder,japanese,jp-native", api_url: "https://sps.estore.jp/", api_auth_method: "unknown" },
  { id: "ecforce", name: "ecforce", category: "ecommerce", description: "D2C-focused EC platform by SUPER STUDIO. Subscription commerce and LTV optimization.", tags: "ecommerce,d2c,subscription,ltv,japanese,jp-native", api_url: "https://ec-force.com/", api_auth_method: "unknown" },
  { id: "w2-commerce", name: "w2Commerce", category: "ecommerce", description: "Unified commerce platform by w2 Solution. EC with omnichannel POS integration.", tags: "ecommerce,omnichannel,pos,japanese,jp-native", api_url: "https://www.w2solution.co.jp/", api_auth_method: "unknown" },

  // ── プロジェクト管理・業務効率化 ──
  { id: "questetra", name: "Questetra BPM Suite", category: "project_management", description: "Cloud-based BPM (Business Process Management). Visual workflow designer with form builder.", tags: "project-management,bpm,workflow,japanese,jp-native", api_url: "https://questetra.com/", api_auth_method: "api_key" },
  { id: "lychee-redmine", name: "Lychee Redmine", category: "project_management", description: "Enhanced Redmine by Agileware. Gantt chart, resource management, and EVM for project management.", tags: "project-management,redmine,gantt,resource,japanese,jp-native", api_url: "https://lychee-redmine.jp/", api_auth_method: "api_key" },
  { id: "wrike-jp", name: "Wrike Japan", category: "project_management", description: "Wrike with Japan localization and support. Full REST API for project and task management.", tags: "project-management,global,japanese", api_url: "https://developers.wrike.com/", api_auth_method: "oauth2" },
  { id: "bizer-team", name: "Bizer team", category: "project_management", description: "Task management for back-office teams. Checklist-based workflow for accounting and HR tasks.", tags: "project-management,back-office,checklist,japanese,jp-native", api_url: "https://bizer.jp/", api_auth_method: "unknown" },
  { id: "stock-app", name: "Stock", category: "project_management", description: "Information sharing tool by LinkLive. Simple note-taking and task management for teams.", tags: "project-management,notes,task,simple,japanese,jp-native", api_url: "https://www.stock-app.info/", api_auth_method: "unknown" },
  { id: "notion-jp", name: "Notion Japan", category: "project_management", description: "Notion with Japan operations and localization. Full API for workspace, database, and page management.", tags: "project-management,wiki,database,global,japanese", api_url: "https://developers.notion.com/", api_auth_method: "oauth2" },

  // ── 経費精算・ワークフロー ──
  { id: "rakuraku-seisan", name: "楽楽精算", category: "expense_workflow", description: "No.1 expense management in Japan by Rakus. Expense reports, travel requests, and payment management.", tags: "expense,workflow,travel,japanese,jp-native", api_url: "https://www.rakurakuseisan.jp/", api_auth_method: "unknown" },
  { id: "concur-jp", name: "SAP Concur Japan", category: "expense_workflow", description: "SAP Concur with Japan localization. Enterprise expense, travel, and invoice management.", tags: "expense,travel,enterprise,sap,japanese", api_url: "https://developer.concur.com/", api_auth_method: "oauth2" },
  { id: "dr-wallet", name: "Dr.経費精算", category: "expense_workflow", description: "AI-powered expense management by BearTail. Receipt OCR and auto-categorization.", tags: "expense,ai,ocr,receipt,japanese,jp-native", api_url: "https://www.keihi.com/", api_auth_method: "unknown" },
  { id: "agile-works", name: "AgileWorks", category: "expense_workflow", description: "Enterprise workflow platform by Atled. Complex approval routing with organizational hierarchy support.", tags: "workflow,approval,enterprise,japanese,jp-native", api_url: "https://www.atled.jp/agileworks/", api_auth_method: "unknown" },
  { id: "x-point", name: "X-point Cloud", category: "expense_workflow", description: "Workflow platform by Atled. Electronic forms with Japanese-style approval routing (稟議).", tags: "workflow,approval,electronic-form,ringi,japanese,jp-native", api_url: "https://www.atled.jp/xpoint_cloud/", api_auth_method: "unknown" },
  { id: "collab-flow", name: "コラボフロー", category: "expense_workflow", description: "Web-based workflow system. Excel/Word form templates with browser-based approval.", tags: "workflow,approval,excel,japanese,jp-native", api_url: "https://www.collabo-style.co.jp/", api_auth_method: "unknown" },
  { id: "create-web", name: "Create!Webフロー", category: "expense_workflow", description: "Workflow system by Infotec. Drag-and-drop approval flow designer.", tags: "workflow,approval,japanese,jp-native", api_url: "https://www.createwebflow.jp/", api_auth_method: "unknown" },
  { id: "bugyo-workflow", name: "奉行クラウド Edge ワークフロー", category: "expense_workflow", description: "Workflow by OBC. Integrated with Bugyo accounting and HR suite.", tags: "workflow,approval,obc,integrated,japanese,jp-native", api_url: "https://www.obc.co.jp/bugyo-cloud/workflow", api_auth_method: "unknown" },
  { id: "kickflow", name: "kickflow", category: "expense_workflow", description: "Modern workflow platform. Developer-friendly approval workflow with API-first design.", tags: "workflow,approval,api-first,modern,japanese,jp-native", api_url: "https://kickflow.com/", api_auth_method: "api_key" },
  { id: "jugaa", name: "ジュガール", category: "expense_workflow", description: "Workflow and approval management. Simple ringi (稟議) system for Japanese organizations.", tags: "workflow,approval,ringi,japanese,jp-native", api_url: "https://www.and-and.co.jp/", api_auth_method: "unknown" },

  // ── カスタマーサポート・CS ──
  { id: "re-lation", name: "Re:lation", category: "support", description: "Multi-channel customer support by InGage. Unified inbox for email, chat, phone, and SNS inquiries.", tags: "support,multi-channel,inbox,japanese,jp-native", api_url: "https://ingage.jp/relation/", api_auth_method: "unknown" },
  { id: "tayori", name: "Tayori", category: "support", description: "Customer support tool by PR TIMES. FAQ, forms, chat, and survey in one platform.", tags: "support,faq,form,chat,pr-times,japanese,jp-native", api_url: "https://tayori.com/", api_auth_method: "unknown" },
  { id: "helpfeel", name: "Helpfeel", category: "support", description: "AI-powered FAQ system by Nota. Intent-prediction search for customer self-service.", tags: "support,faq,ai,search,japanese,jp-native", api_url: "https://www.helpfeel.com/", api_auth_method: "unknown" },
  { id: "karakuri", name: "KARAKURI", category: "support", description: "AI chatbot for customer support by KARAKURI Inc. Deep learning NLP for Japanese support automation.", tags: "support,chatbot,ai,nlp,japanese,jp-native", api_url: "https://karakuri.ai/", api_auth_method: "unknown" },
  { id: "zendesk-jp", name: "Zendesk Japan", category: "support", description: "Zendesk with Japan operations. Full REST API for ticketing, chat, and knowledge base.", tags: "support,ticketing,global,japanese", api_url: "https://developer.zendesk.com/", api_auth_method: "oauth2" },
  { id: "freshdesk-jp", name: "Freshdesk Japan", category: "support", description: "Freshdesk with Japan support. Helpdesk with ticketing, knowledge base, and automation.", tags: "support,helpdesk,global,japanese", api_url: "https://developers.freshdesk.com/", api_auth_method: "api_key" },
  { id: "ai-messenger", name: "AI Messenger", category: "support", description: "AI chatbot platform by AI Shift (CyberAgent group). Custom AI chatbot for enterprise support.", tags: "support,chatbot,ai,cyberagent,japanese,jp-native", api_url: "https://www.ai-messenger.jp/", api_auth_method: "unknown" },
  { id: "chamo", name: "CHAMO", category: "support", description: "Chat support tool by GENIEE. Web chat widget with visitor tracking and auto-messages.", tags: "support,chat,widget,japanese,jp-native", api_url: "https://chamo-chat.com/", api_auth_method: "unknown" },

  // ── セキュリティ・ID管理 ──
  { id: "trustlogin", name: "トラスト・ログイン", category: "security", description: "SSO/IDaaS by GMO GlobalSign. Single sign-on with MFA and access control for cloud apps.", tags: "security,sso,idaas,mfa,gmo,japanese,jp-native", api_url: "https://trustlogin.com/", api_auth_method: "unknown" },
  { id: "lanscope", name: "LANSCOPE", category: "security", description: "IT asset management and endpoint security by MOTEX. Device management, log audit, and DLP.", tags: "security,endpoint,asset-management,dlp,japanese,jp-native", api_url: "https://www.lanscope.jp/", api_auth_method: "unknown" },
  { id: "skysea", name: "SKYSEA Client View", category: "security", description: "IT asset management by Sky. Client device management with log monitoring and security audit.", tags: "security,asset-management,log,audit,japanese,jp-native", api_url: "https://www.skyseaclientview.net/", api_auth_method: "unknown" },
  { id: "digital-arts", name: "i-FILTER", category: "security", description: "Web filtering by Digital Arts. URL filtering and web security for enterprises.", tags: "security,web-filter,url-filter,enterprise,japanese,jp-native", api_url: "https://www.daj.jp/", api_auth_method: "unknown" },
  { id: "onelogin-jp", name: "OneLogin Japan", category: "security", description: "OneLogin with Japan operations. SSO, MFA, and user provisioning with SCIM.", tags: "security,sso,mfa,scim,global,japanese", api_url: "https://developers.onelogin.com/", api_auth_method: "oauth2" },
  { id: "cybertrust", name: "サイバートラスト デバイスID", category: "security", description: "Device certificate authentication by Cybertrust. Device-based access control for zero-trust.", tags: "security,device-auth,certificate,zero-trust,japanese,jp-native", api_url: "https://www.cybertrust.co.jp/", api_auth_method: "unknown" },
  { id: "keeper-jp", name: "Keeper Security Japan", category: "security", description: "Password management with Japan support. Enterprise password vault and privileged access management.", tags: "security,password,pam,enterprise,japanese", api_url: "https://docs.keeper.io/", api_auth_method: "api_key" },

  // ── 建設・不動産 ──
  { id: "andpad", name: "ANDPAD", category: "construction", description: "Construction project management platform. Photo sharing, schedule, and drawing management for construction sites.", tags: "construction,project-management,photo,schedule,japanese,jp-native", api_url: "https://andpad.jp/", api_auth_method: "unknown" },
  { id: "photoruction", name: "Photoruction", category: "construction", description: "Construction photo and drawing management. AI-powered construction document management.", tags: "construction,photo,drawing,ai,japanese,jp-native", api_url: "https://www.photoruction.com/", api_auth_method: "unknown" },
  { id: "spiderplus", name: "SpiderPlus", category: "construction", description: "Construction inspection and reporting app. Tablet-based field inspection with auto-report generation.", tags: "construction,inspection,reporting,tablet,japanese,jp-native", api_url: "https://spider-plus.com/", api_auth_method: "unknown" },
  { id: "kanna", name: "KANNA", category: "construction", description: "Construction management by Aldagram. Simple project and task management for small builders.", tags: "construction,project-management,smb,japanese,jp-native", api_url: "https://lp.kfrp-kanna.com/", api_auth_method: "unknown" },
  { id: "ielove", name: "いえらぶ CLOUD", category: "construction", description: "Real estate management platform. Property listing, CRM, and website builder for real estate agents.", tags: "real-estate,crm,listing,website,japanese,jp-native", api_url: "https://ielove-cloud.jp/", api_auth_method: "unknown" },
  { id: "itandi", name: "ITANDI BB", category: "construction", description: "Real estate tech platform by GA Technologies. Online property viewing and tenant screening.", tags: "real-estate,proptech,tenant,screening,japanese,jp-native", api_url: "https://www.itandi.co.jp/", api_auth_method: "unknown" },
  { id: "akari-ai", name: "燈", category: "construction", description: "Construction AI by Akari. AI-powered estimation, planning, and optimization for construction.", tags: "construction,ai,estimation,optimization,japanese,jp-native", api_url: "https://akariinc.co.jp/", api_auth_method: "unknown" },
  { id: "buildy", name: "Buildy", category: "construction", description: "Construction data platform. Standardized construction data management and analysis.", tags: "construction,data,analysis,japanese,jp-native", api_url: "https://buildy.jp/", api_auth_method: "unknown" },

  // ── 物流・配送 ──
  { id: "openlogi", name: "OpenLogi", category: "logistics", description: "Fulfillment platform. Warehouse network with API-first logistics for EC operators.", tags: "logistics,fulfillment,warehouse,api-first,japanese,jp-native", api_url: "https://service.openlogi.com/", api_auth_method: "api_key" },
  { id: "zaiko-robot", name: "zaiko Robot", category: "logistics", description: "Multi-channel inventory management. Real-time inventory sync across EC marketplaces.", tags: "logistics,inventory,multi-channel,ec,japanese,jp-native", api_url: "https://zaiko-robot.com/", api_auth_method: "unknown" },
  { id: "logikura", name: "ロジクラ", category: "logistics", description: "Cloud-based WMS (Warehouse Management System). Inventory and shipping management for SMB logistics.", tags: "logistics,wms,inventory,shipping,japanese,jp-native", api_url: "https://logikura.jp/", api_auth_method: "unknown" },
  { id: "ship-and-co", name: "Ship&co", category: "logistics", description: "Multi-carrier shipping platform. Unified shipping label creation across carriers (Yamato, Sagawa, Japan Post).", tags: "logistics,shipping,multi-carrier,label,japanese,jp-native", api_url: "https://www.shipandco.com/ja/", api_auth_method: "api_key" },

  // ── 予約・店舗管理 ──
  { id: "toreta", name: "トレタ", category: "reservation", description: "Restaurant reservation management. Table management, customer database, and POS integration for dining.", tags: "reservation,restaurant,table-management,pos,japanese,jp-native", api_url: "https://toreta.in/", api_auth_method: "unknown" },
  { id: "coubic", name: "STORES 予約", category: "reservation", description: "Reservation system by STORES (formerly Coubic). Online booking for salons, studios, and clinics.", tags: "reservation,booking,salon,clinic,stores,japanese,jp-native", api_url: "https://stores.jp/reserve", api_auth_method: "unknown" },
  { id: "airshift", name: "Airシフト", category: "reservation", description: "Shift management by Recruit. Staff scheduling with shift request and labor cost management.", tags: "reservation,shift,scheduling,recruit,japanese,jp-native", api_url: "https://airregi.jp/shift/", api_auth_method: "unknown" },
  { id: "hacomono", name: "hacomono", category: "reservation", description: "Membership and booking management for fitness, schools, and facilities. Member management with billing.", tags: "reservation,membership,fitness,facility,japanese,jp-native", api_url: "https://www.hacomono.jp/", api_auth_method: "unknown" },

  // ── BI・データ分析 ──
  { id: "motion-board", name: "MotionBoard", category: "bi_analytics", description: "BI dashboard by WingArc1st. Real-time dashboards with IoT data visualization.", tags: "bi,dashboard,iot,visualization,japanese,jp-native", api_url: "https://www.wingarc.com/product/motionboard/", api_auth_method: "unknown" },
  { id: "dr-sum", name: "Dr.Sum", category: "bi_analytics", description: "Data warehouse and BI by WingArc1st. In-memory DB with fast aggregation for large datasets.", tags: "bi,data-warehouse,in-memory,aggregation,japanese,jp-native", api_url: "https://www.wingarc.com/product/dr_sum/", api_auth_method: "unknown" },
  { id: "yellowfin-jp", name: "Yellowfin Japan", category: "bi_analytics", description: "Yellowfin BI with Japan operations. Embedded analytics and automated business monitoring.", tags: "bi,embedded,analytics,global,japanese", api_url: "https://wiki.yellowfinbi.com/display/yfcurrent/API", api_auth_method: "api_key" },
  { id: "datapiercing", name: "データピアシング", category: "bi_analytics", description: "Data analytics by GENIEE. Ad-tech data platform with cross-channel analytics.", tags: "bi,ad-tech,analytics,geniee,japanese,jp-native", api_url: "https://geniee.co.jp/", api_auth_method: "unknown" },
  { id: "loglass", name: "Loglass", category: "bi_analytics", description: "Corporate planning platform by Loglass. Budget management, forecasting, and management reporting.", tags: "bi,corporate-planning,budget,forecast,japanese,jp-native", api_url: "https://www.loglass.jp/", api_auth_method: "unknown" },
  { id: "domo-jp", name: "Domo Japan", category: "bi_analytics", description: "Domo BI platform with Japan operations. Cloud-native BI with 1000+ connectors.", tags: "bi,cloud,connectors,global,japanese", api_url: "https://developer.domo.com/", api_auth_method: "oauth2" },

  // ── 医療・ヘルスケア ──
  { id: "clinics", name: "CLINICS", category: "healthcare", description: "Online medical platform by MEDLEY. Telemedicine, appointment booking, and electronic prescriptions.", tags: "healthcare,telemedicine,appointment,prescription,japanese,jp-native", api_url: "https://clinics.medley.life/", api_auth_method: "unknown" },
  { id: "kakehashi", name: "カケハシ Musubi", category: "healthcare", description: "Pharmacy support system by Kakehashi. AI-powered medication guidance and pharmacy management.", tags: "healthcare,pharmacy,ai,medication,japanese,jp-native", api_url: "https://musubi.kakehashi.life/", api_auth_method: "unknown" },
  { id: "carely", name: "Carely", category: "healthcare", description: "Employee health management by iCARE. Health checkup management and industrial physician coordination.", tags: "healthcare,occupational-health,checkup,japanese,jp-native", api_url: "https://www.carely.jp/", api_auth_method: "unknown" },
  { id: "m3", name: "m3.com", category: "healthcare", description: "Medical platform by M3. Doctor community, clinical trial, and medical information platform with API.", tags: "healthcare,doctor,clinical,medical,japanese,jp-native", api_url: "https://www.m3.com/", api_auth_method: "unknown" },
  { id: "medley", name: "ジョブメドレー", category: "healthcare", description: "Medical/nursing job platform by MEDLEY. HR platform for healthcare professionals.", tags: "healthcare,job,medical,nursing,japanese,jp-native", api_url: "https://job-medley.com/", api_auth_method: "unknown" },
  { id: "henry", name: "Henry", category: "healthcare", description: "Cloud-based electronic medical records by Henry. Modern EMR for clinics and small hospitals.", tags: "healthcare,emr,clinic,hospital,japanese,jp-native", api_url: "https://henry-app.jp/", api_auth_method: "unknown" },

  // ── 教育・LMS ──
  { id: "schoo", name: "Schoo for Business", category: "education", description: "Online learning platform for business. 8,000+ video courses for corporate training.", tags: "education,lms,video,corporate-training,japanese,jp-native", api_url: "https://schoo.jp/biz/", api_auth_method: "unknown" },
  { id: "eden-lms", name: "eden LMS", category: "education", description: "Cloud LMS. Simple learning management with course creation and progress tracking.", tags: "education,lms,course,progress,japanese,jp-native", api_url: "https://eden.ac/", api_auth_method: "unknown" },
  { id: "learningboa", name: "learningBOX", category: "education", description: "E-learning platform. Quiz creation, exam management, and certificate issuance.", tags: "education,e-learning,quiz,exam,japanese,jp-native", api_url: "https://learningbox.online/", api_auth_method: "unknown" },
  { id: "classi", name: "Classi", category: "education", description: "School platform by Classi (SoftBank × Benesse). Student-teacher communication and learning management.", tags: "education,school,k12,softbank,benesse,japanese,jp-native", api_url: "https://classi.jp/", api_auth_method: "unknown" },
  { id: "studyplus", name: "Studyplus for School", category: "education", description: "Study management platform for cram schools. Student progress tracking and parent communication.", tags: "education,cram-school,progress,student,japanese,jp-native", api_url: "https://for-school.studyplus.co.jp/", api_auth_method: "unknown" },
  { id: "coeteco", name: "コエテコ", category: "education", description: "Programming school portal by GMO Media. Review platform for coding education.", tags: "education,programming,review,portal,gmo,japanese,jp-native", api_url: "https://coeteco.jp/", api_auth_method: "unknown" },
];

const dryRun = process.argv.includes('--dry-run');

const raw = readFileSync(SEED_PATH, 'utf-8');
const services = JSON.parse(raw);

const existingIds = new Set(services.map(s => s.id));
let added = 0;
let skipped = 0;

for (const svc of NEW_SERVICES) {
  if (existingIds.has(svc.id)) {
    console.log(`SKIP (already exists): ${svc.id}`);
    skipped++;
    continue;
  }

  const entry = {
    id: svc.id,
    name: svc.name,
    namespace: "",
    description: svc.description,
    category: svc.category,
    tags: svc.tags,
    mcp_endpoint: "",
    mcp_status: "unknown",
    trust_score: 0.3,
    api_url: svc.api_url,
    api_auth_method: svc.api_auth_method || "unknown",
    axr_score: 0,
    axr_grade: "pending",
    axr_facade: 0
  };

  services.push(entry);
  existingIds.add(svc.id);
  added++;
  console.log(`ADD: ${svc.id} (${svc.name}) → ${svc.category}`);
}

console.log(`\n--- Summary ---`);
console.log(`Added: ${added}`);
console.log(`Skipped: ${skipped}`);
console.log(`Total services: ${services.length}`);

if (dryRun) {
  console.log('\n[DRY RUN] No changes written.');
} else {
  writeFileSync(SEED_PATH, JSON.stringify(services, null, 2) + '\n', 'utf-8');
  console.log(`\nWritten to ${SEED_PATH}`);
}
