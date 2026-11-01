import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "./ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Spinner } from "./ui/spinner"
import InputLabel from "./InputLabel"
import { useAppSide } from "@/hooks/useAppSide"

// "delete" in either language.
const DELETE_WORDS = ["delete", "מחק"]

// A deletion (or another step that cannot be undone, with its own confirmLabel) the user
// confirms by typing a word: "delete" unless confirmWords says otherwise.
function ConfirmDeleteDialog({ trigger, title, description, inputLabel, confirmWords = DELETE_WORDS, confirmLabel, isDeleting, onConfirm }) {
    const { t } = useTranslation()
    const { isRight, side } = useAppSide()
    const [input, setInput] = useState('')
    const confirmed = confirmWords.some(word => input.toLowerCase() === word.toLowerCase())

    return (
        <Dialog onOpenChange={(open) => !open && setInput('')}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent side={side}>
                <DialogHeader isRight={isRight} className="pt-6">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription isRight={!isRight}>{description}</DialogDescription>
                </DialogHeader>
                <InputLabel id='delete' placeholder=" " type='text' value={input}
                    onChange={(e) => setInput(e.target.value)}>{inputLabel}</InputLabel>
                <DialogFooter className="flex flex-col gap-2 sm:flex-row justify-end">
                    <DialogClose asChild>
                        <Button disabled={isDeleting} className="cursor-pointer" variant='outline'>{t('cancel')}</Button>
                    </DialogClose>
                    <Button className="cursor-pointer" disabled={!confirmed || isDeleting} variant='destructive' onClick={onConfirm}>
                        {isDeleting ? <Spinner /> : (confirmLabel ?? t('delete'))}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ConfirmDeleteDialog
