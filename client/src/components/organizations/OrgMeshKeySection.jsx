import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { rotateMeshKey } from "@/services/apiMeshSettings";

// The key the organization's devices sign their radio messages with. Replacing
// it is for a stolen device or a precaution: gateways take the new one with
// their next report and give it to their leaves, which keep working; leaves on
// firmware older than 2.5.0 cannot and must be set up again. Confirmed by typing
// the organization's name.
function OrgMeshKeySection({ id, organization }) {
    const { t } = useTranslation();
    const rotate = useMutation({
        mutationFn: () => rotateMeshKey(organization._id),
        onSuccess: ({ meshKeyId }) => toast.success(t("components.orgSettingsPage.meshKey.rotated", { generation: meshKeyId })),
        onError: (error) => toast.error(error.message),
    });

    return (
        <SettingsSection id={id} title={t("components.orgSettingsPage.meshKey.title")}
            description={t("components.orgSettingsPage.meshKey.description")}>
            <SettingsRow label={t("components.orgSettingsPage.meshKey.rotate")} description={t("components.orgSettingsPage.meshKey.rotateHint")}>
                <ConfirmDeleteDialog
                    trigger={<Button disabled={rotate.isPending} variant="outline_destructive">
                        {rotate.isPending ? <Spinner /> : t("components.orgSettingsPage.meshKey.rotateButton")}
                    </Button>}
                    title={t("components.orgSettingsPage.meshKey.confirmTitle")}
                    description={t("components.orgSettingsPage.meshKey.confirmDescription")}
                    inputLabel={t("components.orgSettingsPage.meshKey.typeName", { name: organization.name })}
                    confirmWords={[organization.name]}
                    confirmLabel={t("components.orgSettingsPage.meshKey.rotateButton")}
                    isDeleting={rotate.isPending}
                    onConfirm={() => rotate.mutate()}
                />
            </SettingsRow>
        </SettingsSection>
    );
}

export default OrgMeshKeySection;
