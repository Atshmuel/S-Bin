import { FormProvider } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormMessage } from "../ui/form";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { useState } from "react";
import InputLabel from "../InputLabel";
import { Eye, EyeOff } from "lucide-react";
import { useMe } from "@/hooks/users/auth/useMe";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";
import { useOrgManagers } from "@/hooks/users/useOrgManagers";
import { Skeleton } from "../ui/skeleton";
import { useOrganizations } from "@/hooks/organizations/useOrganizations";
import { useAppSide } from "@/hooks/useAppSide";
import { useTranslation } from "react-i18next";

// A field with a few fixed choices (the role, the status) as a list to pick
// from: a row of buttons does not fit a phone, nor every language.
function OptionSelect({ field, name, options, disabled }) {
    const { isRight } = useAppSide()
    const { t } = useTranslation()
    const text = (key) => t(`newEntity.userInputs.fields.${name}.${key}`)
    return (
        <FormItem>
            <Label>{text("label")}</Label>
            <Select isRight={isRight} disabled={disabled} value={field.value} onValueChange={field.onChange}>
                <FormControl>
                    <SelectTrigger isRight={isRight} className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                </FormControl>
                <SelectContent className="z-[1000]">
                    {options.map(option => (
                        <SelectItem isRight={isRight} key={option} value={option}>{text(`options.${option}`)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <FormDescription>{text("description")}</FormDescription>
        </FormItem>
    )
}

function UserInputs({ form, isCreating }) {
    const { me, isOwner } = useMe();
    const { isRight } = useAppSide()
    const { t } = useTranslation()


    const [showPassword, setShowPassword] = useState(false);
    const { data: organizations, isLoadingOrgs, orgsError } = useOrganizations()

    const selectedOrgId = isOwner ? form.watch("org") : me.org;
    const { managers, isLoadingManagers, managersError } = useOrgManagers(selectedOrgId);

    return (
        <FormProvider {...form} >
            <div className="space-y-4">
                <FormField
                    name="name"
                    control={form.control}
                    rules={{
                        required: t("newEntity.userInputs.validation.name.required"), validate: {
                            notEmpty: (value) =>
                                value.trim().length > 0 || t("newEntity.userInputs.validation.name.notEmpty"),
                            fullName: (value) => {
                                const parts = value.trim().split(/\s+/);
                                return parts.length >= 2 || t("newEntity.userInputs.validation.name.fullName");
                            },
                            noWhitespace: (value) => {
                                return value.trim() === value || t("newEntity.userInputs.validation.name.noWhitespace");
                            }
                        }
                    }
                    }
                    render={({ field }) => (
                        <FormItem>
                            <Label>{t("newEntity.userInputs.fields.fullName.label")}</Label>
                            <Input disabled={isCreating} className="pb-2" {...field} placeholder={t("newEntity.userInputs.fields.fullName.placeholder")} type="text" />
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    name="email"
                    control={form.control}
                    rules={{
                        required: t("newEntity.userInputs.validation.email.required"),
                        pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: t("newEntity.userInputs.validation.email.invalid"),
                        },
                        validate: {
                            notEmpty: (value) =>
                                value.trim().length > 0 || t("newEntity.userInputs.validation.email.notEmpty"),
                            noWhitespace: (value) => {
                                return value.trim() === value || t("newEntity.userInputs.validation.email.noWhitespace");
                            }
                        },
                    }}
                    render={({ field }) => (
                        <FormItem>
                            <Label>{t("newEntity.userInputs.fields.email.label")}</Label>
                            <Input disabled={isCreating} className="pb-2" {...field} placeholder={t("newEntity.userInputs.fields.email.placeholder")} type="text" />
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    name="password"
                    control={form.control}
                    rules={{
                        required: t("newEntity.userInputs.validation.password.required"),
                        minLength: {
                            value: 8,
                            message: t("newEntity.userInputs.validation.password.minLength"),
                        },
                        maxLength: {
                            value: 30,
                            message: t("newEntity.userInputs.validation.password.maxLength"),
                        },
                        validate: {
                            hasLowercase: (value) =>
                                /[a-z]/.test(value) ||
                                t("newEntity.userInputs.validation.password.lowercase"),
                            hasUppercase: (value) =>
                                /[A-Z]/.test(value) ||
                                t("newEntity.userInputs.validation.password.uppercase"),
                            hasNumber: (value) =>
                                /[0-9]/.test(value) ||
                                t("newEntity.userInputs.validation.password.number"),
                            hasSpecial: (value) =>
                                /[!@#$%^&*]/.test(value) ||
                                t("newEntity.userInputs.validation.password.special"),
                        },
                    }}
                    render={({ field }) => (
                        <FormItem>
                            <div className="relative">
                                <InputLabel disabled={isCreating}{...field} placeholder=" " type={showPassword ? "text" : "password"} >{t("newEntity.userInputs.fields.password.label")}</InputLabel>
                                {showPassword ? <Eye onClick={() => setShowPassword(show => !show)}
                                    className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} /> :
                                    <EyeOff onClick={() => setShowPassword(show => !show)} className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} />}
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    name="role"
                    control={form.control}
                    render={({ field }) => (
                        <OptionSelect field={field} name="role" disabled={isCreating}
                            options={["user", "driver", "technician", "admin", ...(me.role === 'owner' ? ["owner"] : [])]} />
                    )}
                />
                <FormField
                    name="status"
                    control={form.control}
                    render={({ field }) => (
                        <OptionSelect field={field} name="status" disabled={isCreating}
                            options={["pending", "active", "inactive", "suspended"]} />
                    )}
                />
                {isOwner ?
                    <FormField
                        name="org"
                        control={form.control}
                        render={({ field }) => (
                            <FormItem className="px-1">
                                <Label>{t("newEntity.userInputs.fields.organization.label")}</Label>
                                <FormControl>
                                    {isLoadingOrgs ? <Skeleton className="w-full px-1 h-10" /> :
                                        <Select isRight={isRight} onValueChange={field.onChange}
                                            value={field.value ?? ""}
                                        >
                                            <SelectTrigger isRight={isRight} >
                                                <SelectValue placeholder={t("newEntity.userInputs.fields.organization.placeholder")} />
                                            </SelectTrigger>
                                            <SelectContent className="z-[1000]">
                                                <SelectGroup>
                                                    <SelectLabel isRight={isRight}>{orgsError ? t("newEntity.userInputs.fields.organization.error") : t("newEntity.userInputs.fields.organization.label")}</SelectLabel>
                                                    <div className="max-h-52 overflow-y-auto">
                                                        {!orgsError ? organizations?.map(m => (
                                                            <SelectItem isRight={isRight} className="capitalize truncate" key={m._id} value={m._id}>{m.name}</SelectItem>
                                                        )) : null}
                                                    </div>
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>}
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    : null}
                <FormField
                    name="manager"
                    control={form.control}
                    render={({ field }) => (
                        <FormItem className="px-1">
                            <Label>{t("newEntity.userInputs.fields.manager.label")}</Label>
                            <FormControl>
                                {isLoadingManagers ? <Skeleton className="w-full px-1 h-10" /> :
                                    <Select isRight={isRight} onValueChange={field.onChange}
                                        value={field.value ?? ""}
                                    >
                                        <SelectTrigger isRight={isRight}>
                                            <SelectValue placeholder={t("newEntity.userInputs.fields.manager.placeholder")} />
                                        </SelectTrigger>
                                        <SelectContent className="z-[1000]">
                                            <SelectGroup>
                                                <SelectLabel isRight={isRight}>{managersError ? t("newEntity.userInputs.fields.manager.error") : t("newEntity.userInputs.fields.manager.label")}</SelectLabel>
                                                <div className="max-h-52 overflow-y-auto">
                                                    {!managersError ? managers?.map(m => (
                                                        <SelectItem isRight={isRight} className="capitalize" key={m._id} value={m._id} isbadged={m.role}>{m.name}</SelectItem>
                                                    )) : null}
                                                </div>
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>}
                            </FormControl>
                        </FormItem>
                    )}
                />

            </div>
        </FormProvider>
    )
}

export default UserInputs
