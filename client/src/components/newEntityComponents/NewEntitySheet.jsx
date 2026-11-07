import { LucidePlus, Plus } from "lucide-react"
import { Button } from "../ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet"

import { useForm } from "react-hook-form"
import UserInputs from "./UserInputs"
import OrgInputs from './OrgInputs'
import { useCreateUser } from "@/hooks/users/useCreateUser"
import { useMe } from "@/hooks/users/auth/useMe"
import { useCreateOrg } from "@/hooks/organizations/useCreateOrg"
import { useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"

function NewEntitySheet({ isExpanded }) {
    const { create, isCreating } = useCreateUser()
    const { createOrg, isCreatingOrg } = useCreateOrg()
    const { t } = useTranslation();


    const [isUserCreation, setIsUserCreation] = useState(true);
    const { me, isOwner } = useMe()
    const { side, isRight } = useAppSide()

    const userForm = useForm({
        defaultValues: {
            name: '',
            email: '',
            password: '',
            role: 'user',
            status: 'active',
            org: !isOwner ? me.org : null,
            manager: null
        }
    })
    const orgForm = useForm({
        defaultValues: {
            name: ""
        }
    })

    function handleReset() {
        userForm.reset({
            name: '',
            email: '',
            password: '',
            role: 'user',
            status: 'active',
            org: !isOwner ? me.org : null,
            manager: null
        });

        orgForm.reset({
            name: ''
        })
    }

    const onSubmitUser = userForm.handleSubmit(async (data) => {
        const res = await create(data)
        if (res) {
            handleReset()
        }
    });

    const onSubmitOrg = orgForm.handleSubmit(async (data) => {
        const res = await createOrg(data)
        if (res) {
            handleReset()
        }
    })


    const ToggleView = () => {
        return isOwner ? <ToggleGroup disabled={isCreating} className="mt-3 border-[0.1px] border-primary rounded-md" type="single" value={isUserCreation ? "user" : "org"} onValueChange={(value) => {
            if (value) {
                setIsUserCreation(v => !v)
            }
        }}>
            <ToggleGroupItem className='w-full data-[state=on]:bg-primary data-[state=on]:text-accent' value="user">{t("user")}</ToggleGroupItem>
            <ToggleGroupItem className='w-full data-[state=on]:bg-primary data-[state=on]:text-accent' value="org">{t("organization")}</ToggleGroupItem>
        </ToggleGroup> : null
    }

    return (
        <Sheet >
            <SheetTrigger asChild>
                <Button size={isExpanded ? 'default' : 'icon'}>{isExpanded ? <div className={`flex  items-center ${isRight ? '' : 'flex-row-reverse'} gap-2`}><LucidePlus /> <span>{t("newEntity.title")}</span></div> : <LucidePlus />}</Button>
            </SheetTrigger>
            {/* The whole width on a phone; only the fields scroll, the buttons stay at the bottom. */}
            <SheetContent side={side} className="w-full sm:max-w-md">
                <SheetHeader>
                    <SheetTitle className={'text-sm  md:text-lg'}>{isUserCreation ? t("newEntity.createNewUser") : t("newEntity.createNewOrganization")}</SheetTitle>
                    <SheetDescription> {isUserCreation ? t("newEntity.createNewUserSubtitle") : t("newEntity.createNewOrganizationSubtitle")}</SheetDescription>
                    <ToggleView />
                </SheetHeader>
                <form id="create-entity-form" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2" onSubmit={isUserCreation ? onSubmitUser : onSubmitOrg} >
                    {isUserCreation ?
                        <UserInputs form={userForm} isCreating={isCreating} />
                        :
                        <OrgInputs form={orgForm} isCreating={isCreatingOrg} />
                    }
                </form>
                <SheetFooter>
                    <Button form="create-entity-form" type="submit">
                        {isUserCreation ? t("newEntity.createNewUser") : t("newEntity.createNewOrganization")}</Button>
                    <Button type='button' onClick={handleReset} variant="outline_destructive">{t("reset")}</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet >

    )
}

export default NewEntitySheet
