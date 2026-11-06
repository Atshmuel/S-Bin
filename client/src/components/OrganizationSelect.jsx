import { useTranslation } from "react-i18next"
import { Building2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppSide } from "@/hooks/useAppSide"
import { useSelectedOrg } from "@/hooks/organizations/useSelectedOrg"
import { useOrganizations } from "@/hooks/organizations/useOrganizations"

const ALL = "all"

// The owner's pick of the organization the dashboard and the analytics page
// show; nothing for other users, who only see their own.
function OrganizationSelect({ className }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const { selectedOrgId, setSelectedOrgId, isOwner } = useSelectedOrg()
    const { data: organizations, isLoadingOrgs, orgsError } = useOrganizations()
    if (!isOwner) return null
    if (isLoadingOrgs) return <Skeleton className="h-9 w-56" />

    // A remembered organization that no longer exists falls back to all.
    const known = organizations?.some(org => org._id === selectedOrgId)
    return (
        <Select isRight={isRight} value={known ? selectedOrgId : ALL}
            onValueChange={(value) => setSelectedOrgId(value === ALL ? null : value)}>
            <SelectTrigger isRight={isRight} className={cn("w-56 bg-background", className)} aria-label={t("components.organizationSelect.label")}>
                <Building2 />
                <SelectValue />
            </SelectTrigger>
            {/* Above the dashboard's map, whose controls Leaflet layers at 1000. */}
            <SelectContent className="z-[1000]">
                <SelectGroup>
                    <SelectItem isRight={isRight} value={ALL}>{t("components.organizationSelect.all")}</SelectItem>
                    {!orgsError && organizations?.map(org => (
                        <SelectItem isRight={isRight} className="truncate" key={org._id} value={org._id}>{org.name}</SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}

export default OrganizationSelect
