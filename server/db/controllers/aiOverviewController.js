import { GoogleGenAI } from "@google/genai"
import { z } from "zod"
import { userSettingModel } from '../models/models.js'
import { AI_INSTRUCTIONS, AI_MODEL, AI_OVERVIEW_CACHE_MS, ROLES } from '../../utils/constants.js'
import { buildFleetBriefing } from './analyticsController.js'

const insightsSchema = z.object({
    insights: z.array(z.object({
        title: z.string().describe('A short headline, at most five words'),
        content: z.string().describe('At most two sentences for the operations manager'),
    })),
})

// The overviews made lately, by fleet, role and language (see overviewKey), and
// the ones being made: a reload or a second user of the same fleet gets the
// same cards instead of another call to the model.
const recentOverviews = new Map();
const pendingOverviews = new Map();

// What an overview depends on: the fleet the user sees, whether they see its
// money (managers), and the language.
function overviewKey(user, language) {
    const fleet = user.role === ROLES.OWNER ? `owner:${user.selectedOrg ?? 'all'}` : `org:${user.org}`;
    return `${fleet}|${[ROLES.OWNER, ROLES.ADMIN].includes(user.role) ? 'manager' : user.role}|${language}`;
}

// The AI overview: four action-oriented cards from the fleet briefing (the
// numbers the dashboard and analytics compute, by device name), in the user's
// language. Each API key is tried in turn.
export async function getAIOverview(req, res) {
    try {
        const settings = await userSettingModel.findOne({ userId: req.user.id }).select('appLanguage -_id').lean()
        const language = settings?.appLanguage === 'he' ? 'Hebrew' : 'English'
        const key = overviewKey(req.user, language)
        const recent = recentOverviews.get(key)
        if (recent && Date.now() - recent.at < AI_OVERVIEW_CACHE_MS) return res.status(200).json({ insights: recent.insights })

        if (!pendingOverviews.has(key)) {
            pendingOverviews.set(key, makeOverview(req.user, language).finally(() => pendingOverviews.delete(key)))
        }
        const insights = await pendingOverviews.get(key)
        // Expired entries go when the map is written to, so it stays as small as the fleets in use.
        for (const [entryKey, entry] of recentOverviews) {
            if (Date.now() - entry.at >= AI_OVERVIEW_CACHE_MS) recentOverviews.delete(entryKey)
        }
        recentOverviews.set(key, { insights, at: Date.now() })
        res.status(200).json({ insights })
    } catch (error) {
        res.status(500).json({ message: error?.message || 'Failed to generate the AI overview.' })
    }
}

// The cards for one fleet and language from the model; each API key is tried in turn.
async function makeOverview(user, language) {
    const briefing = await buildFleetBriefing(user)
    if (!briefing) return []
    const instructions = AI_INSTRUCTIONS.replaceAll('{{language}}', language)
    const apiKeys = [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_SECOND_KEY,
        process.env.GEMINI_API_THIRD_KEY,
        process.env.GEMINI_API_FOURTH_KEY,
    ].filter(Boolean)
    let lastError
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            const response = await new GoogleGenAI({ apiKey: apiKeys[i] }).models.generateContent({
                model: AI_MODEL,
                contents: instructions + JSON.stringify(briefing),
                config: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: insightsSchema.toJSONSchema(),
                },
            })
            const text = response?.candidates?.[0]?.content?.parts?.[0]?.text
            return JSON.parse(text)?.insights ?? []
        } catch (error) {
            lastError = error
            if (i < apiKeys.length - 1) console.warn(`AI overview: API key ${i + 1} failed, trying the next one.`, error?.message)
        }
    }
    throw new Error(lastError?.message || 'Failed to generate the AI overview.')
}
