import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import OrgDangerZoneSection from "@/components/organizations/OrgDangerZoneSection";
import OrgDepotSection from "@/components/organizations/OrgDepotSection";
import OrgRoutePlanningSection from "@/components/organizations/OrgRoutePlanningSection";
import OrgMapSection from "@/components/organizations/OrgMapSection";
import OrgMeshKeySection from "@/components/organizations/OrgMeshKeySection";
import OrgCostsSection from "@/components/organizations/OrgCostsSection";
import OrgThresholdsSection from "@/components/organizations/OrgThresholdsSection";
import OrgFleetSection from "@/components/organizations/OrgFleetSection";
import OrgGeneralSection from "@/components/organizations/OrgGeneralSection";
import OrgReportingSection from "@/components/organizations/OrgReportingSection";
import SettingsLayout from "@/components/settings/SettingsLayout";
import LoadingProfile from "@/components/userPageComponents/LoadingProfile";
import { useMe } from "@/hooks/users/auth/useMe";
import { getMeshSettings } from "@/services/apiMeshSettings";
import ErrorPage from "../generals/ErrorPage";

// One organization's settings: an owner's for any organization (from the
// organizations table), an admin's for their own.
function OrganizationSettings() {
    const { id } = useParams();
    const { t, i18n } = useTranslation();
    const { isOwner } = useMe();
    const settingsQuery = useQuery({ queryKey: ["mesh-settings"], queryFn: getMeshSettings });
    const organization = settingsQuery.data?.organizations?.find(org => org._id === id);

    if (settingsQuery.isPending) return <LoadingProfile />;
    if (settingsQuery.isError) return <ErrorPage code={500} description={settingsQuery.error.message} navTo="/" buttonText={t("pages.userProfile.errorButton")} />;
    if (!organization) return <ErrorPage code={404} description={t("components.orgSettings.empty")} navTo="/" buttonText={t("pages.userProfile.errorButton")} />;

    const header = (
        <div className="flex items-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted"><Building2 className="size-7" /></div>
            <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("components.orgSettingsPage.header")}</p>
                <h1 className="truncate text-2xl font-semibold" dir="auto">{organization.name}</h1>
            </div>
        </div>
    );
    // Keyed by the saved values, so a section's form starts again from them after a save.
    const reportingKey = `${organization.meshAwakeWindowSeconds}-${organization.reportIntervalMinutes}-${organization.reportStartHour}`;
    return (
        <SettingsLayout header={header} listLabel={t("components.orgSettingsPage.nav.label")}
            sectionName={sectionId => t(`components.orgSettingsPage.nav.${sectionId}`)}
            sections={[
                { id: "general", element: <OrgGeneralSection key={organization.name} id="general" organization={organization} canRename={isOwner} /> },
                { id: "reporting", element: <OrgReportingSection key={reportingKey} id="reporting" organization={organization} /> },
                { id: "thresholds", element: <OrgThresholdsSection key={JSON.stringify(organization.thresholds ?? {})} id="thresholds" organization={organization} /> },
                { id: "fleet", element: <OrgFleetSection key={i18n.language + JSON.stringify(organization.fleet ?? [])} id="fleet" organization={organization} /> },
                { id: "depot", element: <OrgDepotSection key={JSON.stringify(organization.depot ?? null)} id="depot" organization={organization} /> },
                { id: "routePlanning", element: <OrgRoutePlanningSection key={String(organization.routePlanningHour)} id="routePlanning" organization={organization} /> },
                { id: "costs", element: <OrgCostsSection key={JSON.stringify(organization.costs ?? {})} id="costs" organization={organization} /> },
                { id: "meshKey", element: <OrgMeshKeySection id="meshKey" organization={organization} /> },
                { id: "map", element: <OrgMapSection key={String(organization.clusterUntilZoom)} id="map" organization={organization} /> },
                ...(isOwner ? [{ id: "danger", element: <OrgDangerZoneSection id="danger" organization={organization} /> }] : []),
            ]} />
    );
}

export default OrganizationSettings;
