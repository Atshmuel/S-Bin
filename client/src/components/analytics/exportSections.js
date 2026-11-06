// The analytics cards that are in the page's export: the overview section each
// reads and the tables (one sheet each) it makes of the section's data, `ctx` being { t, i18n }.
// A card that shows the fleet as it is now (fullness, battery, connectivity) is not in it.

const HEALTH_CAUSES = ["fillSensor", "battery", "scale", "gps", "connectivity"]
const SPENT_PARTS = ["fuel", "crew", "disposal", "system"]

const label = (ctx, key) => ctx.t(`pages.analytics.sections.${key}`)

export const EXPORT_SECTIONS = Object.freeze([
    {
        section: "collections",
        tables: (data, ctx) => [{
            sheet: label(ctx, "collections.title"),
            header: [ctx.t("components.exportCsv.day"), label(ctx, "collections.count"), label(ctx, "collections.fullness")],
            rows: data.daily.map(day => [day.day, day.count, day.avgFullnessBefore]),
        }],
    },
    {
        section: "waste",
        tables: (data, ctx) => [{
            sheet: label(ctx, "waste.title"),
            header: [ctx.t("components.exportCsv.day"), label(ctx, "waste.kg")],
            rows: data.daily.map(day => [day.day, day.kg]),
        }],
    },
    {
        section: "weekdays",
        tables: (data, ctx) => [{
            sheet: label(ctx, "weekdays.title"),
            // 2024-01-07 was a Sunday; the names come in the page's language.
            header: ["", label(ctx, "weekdays.perDay"), label(ctx, "collections.fullness")],
            rows: data.weekdays.map(entry => [
                new Date(Date.UTC(2024, 0, 7 + entry.weekday)).toLocaleDateString(ctx.i18n.language, { weekday: "long", timeZone: "UTC" }),
                entry.avgCollections, entry.avgFullnessBefore,
            ]),
        }],
    },
    {
        section: "routes",
        tables: (data, ctx) => [
            {
                sheet: label(ctx, "routes.title"),
                header: [ctx.t("components.exportCsv.day"), label(ctx, "routes.done"), label(ctx, "routes.skipped")],
                rows: data.daily.map(day => [day.day, day.done, day.skipped]),
            },
            ...(data.drivers?.length > 0 ? [{
                sheet: `${label(ctx, "routes.title")} - ${ctx.t("components.exportCsv.drivers")}`,
                header: ["driver", "routes", "collected", "confirmed", "contradicted", "minutesPerStop"].map(column => label(ctx, `routes.columns.${column}`)),
                rows: data.drivers.map(driver => [
                    driver.name ?? ctx.t("pages.routes.unknownDriver"), driver.routes, driver.collected,
                    driver.confirmedPercent, driver.contradicted, driver.minutesPerStop,
                ]),
            }] : []),
        ],
    },
    {
        section: "problem-bins",
        tables: (data, ctx) => [{
            sheet: label(ctx, "problemBins.title"),
            header: [...["bin", "score", "skipped", "contradicted", "problemDays", "rate"].map(column => label(ctx, `problemBins.columns.${column}`)), label(ctx, "problemBins.skippedReasons")],
            rows: data.bins.map(bin => [
                bin.binName, bin.score, bin.skipped, bin.contradicted, bin.problemDays,
                bin.ratePerDay == null ? null : Math.round(bin.ratePerDay),
                Object.entries(bin.reasons).map(([reason, count]) =>
                    `${reason === "none" ? label(ctx, "problemBins.noReason") : ctx.t(`pages.routes.skipReasons.${reason}`)} ${count}`).join(" · "),
            ]),
        }],
    },
    {
        section: "health-causes",
        tables: (data, ctx) => [{
            sheet: label(ctx, "healthCauses.title"),
            header: [ctx.t("components.exportCsv.day"), ...HEALTH_CAUSES.map(cause => label(ctx, `healthCauses.${cause}`))],
            rows: data.daily.map(day => [day.day, ...HEALTH_CAUSES.map(cause => day[cause])]),
        }],
    },
    {
        // Owners and admins only.
        section: "costs",
        adminOnly: true,
        tables: (data, ctx) => [
            {
                sheet: label(ctx, "costs.title"),
                header: ["", ""],
                rows: [
                    [label(ctx, "costs.spent"), data.spent.total],
                    ...SPENT_PARTS.map(part => [
                        part === "system" ? ctx.t("pages.analytics.sections.costs.spentOn.systemDevices", { count: data.spent.devices }) : label(ctx, `costs.spentOn.${part}`),
                        data.spent[part],
                    ]),
                    [label(ctx, "costs.saved"), data.saved.money],
                    [label(ctx, "costs.avoided"), data.collections.avoided],
                    [label(ctx, "costs.co2"), data.saved.co2Kg],
                ],
            },
            {
                sheet: `${label(ctx, "costs.title")} - ${ctx.t("components.exportCsv.perDay")}`,
                header: [ctx.t("components.exportCsv.day"), label(ctx, "costs.spent"), label(ctx, "costs.saved")],
                rows: data.daily.map(day => [day.day, day.spent, day.saved]),
            },
        ],
    },
])
