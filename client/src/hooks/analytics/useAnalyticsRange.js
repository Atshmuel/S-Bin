import { createContext, useContext } from "react"
import { DEFAULT_ANALYTICS_RANGE_DAYS } from "@/utils/constants"

// The period (in days) the analytics page shows: one picker at the top of the
// page sets it for every section that covers a period.
export const AnalyticsRangeContext = createContext(DEFAULT_ANALYTICS_RANGE_DAYS)

export function useAnalyticsRange() {
    return useContext(AnalyticsRangeContext)
}
