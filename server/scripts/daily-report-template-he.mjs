// Adds (or updates) the Hebrew daily report email template, "dailyReportHe",
// next to the English "dailyReport", whose sender it copies. The report is sent
// with it to users whose app language is Hebrew (see db/service/dailyReportService.js).
//
//   node scripts/daily-report-template-he.mjs
import dotenv from "dotenv";
import mongoose from "mongoose";
import { templateModel } from "../db/models/models.js";

dotenv.config({ quiet: true });

const TEMPLATE_ID = "dailyReportHe";
const subject = "דוח יומי";
const textTemplate = `אפליקציית Smart Bin

דוח יומי: {{orgName}}

שלום{{name}},
אלה הדברים שדורשים את תשומת לבך היום:

{{sectionsText}}

מייל זה נשלח אליך כי התראות במייל מופעלות בהגדרות שלך.

© 2025 אפליקציית Smart Bin`;
const htmlTemplate = `<!DOCTYPE html>
<html lang='he' dir='rtl'>
<head><meta charset='utf-8' /><meta name='viewport' content='width=device-width,initial-scale=1' /><title>דוח יומי</title></head>
<body dir='rtl' style='font-family: Arial, Helvetica, sans-serif; background:#f4f4f4; margin:0; padding:20px; direction:rtl; text-align:right;'>
<table role='presentation' cellspacing='0' cellpadding='0' align='center' dir='rtl' style='max-width:600px; width:100%; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.06);'>
<tr><td style='background:#0b7a57; padding:20px; text-align:center; color:#ffffff;'><h1 style='margin:0; font-size:22px;'>אפליקציית Smart Bin</h1></td></tr>
<tr><td style='padding:32px 28px;'>
<h2 style='margin:0 0 16px 0; font-size:20px; color:#333; text-align:center;'>דוח יומי: {{orgName}}</h2>
<p style='margin:0; color:#555; line-height:1.6; font-size:16px;'>שלום{{name}},<br/>אלה הדברים שדורשים את תשומת לבך היום:</p>
{{sectionsHtml}}
<p style='margin:28px 0 0 0; color:#999; font-size:13px;'>מייל זה נשלח אליך כי התראות במייל מופעלות בהגדרות שלך.</p>
</td></tr>
<tr><td style='padding:14px; text-align:center; background:#fafafa; font-size:12px; color:#bbb;'>&copy; 2025 אפליקציית Smart Bin</td></tr>
</table>
</body>
</html>`;

await mongoose.connect(process.env.DB_URL);
const english = await templateModel.findOne({ templateId: "dailyReport" }).lean();
if (!english) {
    console.error('The English "dailyReport" template is missing.');
    process.exit(1);
}
const result = await templateModel.updateOne(
    { templateId: TEMPLATE_ID },
    { $set: { email: english.email, subject, textTemplate, htmlTemplate } },
    { upsert: true },
);
console.log(result.upsertedCount ? `Added ${TEMPLATE_ID}.` : `Updated ${TEMPLATE_ID}.`);
await mongoose.disconnect();
