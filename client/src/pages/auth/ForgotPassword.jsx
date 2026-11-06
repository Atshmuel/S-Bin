import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import InputLabel from "@/components/InputLabel";
import { FormProvider, useForm } from "react-hook-form";
import {
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form"
import { NavLink, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Eye, EyeOff } from "lucide-react";
import { useForgot, useOtp, useUpdatePasswordByToken } from "@/hooks/users/auth/useForgot";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { useAppSide } from "@/hooks/useAppSide";


function ForgotPassword() {
    const { forgot, isFetchingForgot } = useForgot()
    const { otp, isVerifingOtp } = useOtp()
    const { isRight } = useAppSide()
    const { t } = useTranslation()
    const { updatePassword, isUpdatingPassword } = useUpdatePasswordByToken()


    const [searchParams] = useSearchParams();
    const emailParam = searchParams.get('email');

    const [showPassword, setShowPassword] = useState(false);
    const [api, setApi] = useState(null);

    const stepOneForm = useForm({
        defaultValues: {
            email: emailParam || '',
        }
    });
    const stepTwoForm = useForm({
        defaultValues: {
            code: '',
        }
    });
    const stepThreeForm = useForm({
        defaultValues: {
            password: "",
            confirmPassword: "",
        }
    });
    function handleStep(formData, stepNum) {
        const action = () => api.scrollNext()
        let email = null
        switch (stepNum) {
            case 1:
                forgot({ ...formData, action })
                break;
            case 2:
                email = stepOneForm.getValues().email
                otp({ ...formData, email, action })
                break;
            case 3:
                email = stepOneForm.getValues().email
                updatePassword({ ...formData, email })
                break;

            default:
                break
        }
    }


    return (
        <div className="flex items-center justify-center min-h-screen bg-background px-4 relative">
            <Carousel className="w-full max-w-md" setApi={setApi}>
                <CarouselContent isRight={isRight}>
                    <CarouselItem key={1}>
                        <Card className="w-full max-w-md shadow-lg">
                            <CardHeader>
                                <CardTitle >
                                    {t("pages.forgotPasswordPage.stepOne.title")}
                                </CardTitle>
                                <p className="text-sm text-muted-foreground">
                                    {t("pages.forgotPasswordPage.stepOne.description")}
                                </p>
                            </CardHeader>
                            <CardContent>
                                <FormProvider {...stepOneForm}>
                                    <form onSubmit={stepOneForm.handleSubmit(formData => handleStep(formData, 1))} className="space-y-6">
                                        <FormField
                                            name="email"
                                            control={stepOneForm.control}
                                            rules={{
                                                required: t("pages.forgotPasswordPage.stepOne.errors.emailRequired"),
                                                pattern: {
                                                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                                                    message: t("pages.forgotPasswordPage.stepOne.errors.invalidEmail"),
                                                },
                                                validate: {
                                                    notEmpty: (value) =>
                                                        value.trim().length > 0 || t("pages.forgotPasswordPage.stepOne.errors.emailNotEmpty"),
                                                },
                                            }}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <InputLabel {...field} placeholder=" " type="email">
                                                        {t("pages.forgotPasswordPage.stepOne.emailLabel")}
                                                    </InputLabel>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <Button
                                            type="submit"
                                            className="w-full cursor-pointer"
                                            disabled={isFetchingForgot}
                                        >
                                            {isFetchingForgot ? <Spinner /> : t("pages.forgotPasswordPage.stepOne.sendRecovery")}
                                        </Button>
                                    </form>

                                </FormProvider>
                            </CardContent>
                            <CardFooter>
                                <div className="sm:flex text-center justify-between w-full">
                                    <p className="text-sm text-muted-foreground p-0 m-0">
                                        {t("pages.forgotPasswordPage.remembered")}
                                        <Button variant='link'>
                                            <NavLink to={'/login'}>{t("pages.forgotPasswordPage.login")}</NavLink>
                                        </Button>
                                    </p>
                                    <p className="text-sm text-muted-foreground p-0 m-0">
                                        {t("pages.forgotPasswordPage.noAccount")}
                                        <Button variant='link'>
                                            <NavLink to={'/signup'}>{t("pages.forgotPasswordPage.signUp")}</NavLink>
                                        </Button>
                                    </p>
                                </div>
                            </CardFooter>
                        </Card>
                    </CarouselItem>
                    <CarouselItem key={2}>
                        <Card className="w-full max-w-md shadow-lg">
                            <CardHeader>
                                <CardTitle >
                                    {t("pages.forgotPasswordPage.stepTwo.title")}
                                </CardTitle>
                                <p className="text-sm text-muted-foreground">
                                    {t("pages.forgotPasswordPage.stepTwo.otpTitle")}                    </p>
                            </CardHeader>
                            <CardContent className="pb-2">
                                <FormProvider {...stepTwoForm}>
                                    <form onSubmit={stepTwoForm.handleSubmit(formData => handleStep(formData, 2))} className="space-y-6">
                                        <FormField
                                            name="code"
                                            control={stepTwoForm.control}
                                            rules={{
                                                required: t("pages.forgotPasswordPage.stepTwo.otpRequired"),
                                                validate: {
                                                    isSixDigits: (value) =>
                                                        value.trim().length === 6 || t("pages.forgotPasswordPage.stepTwo.otpLength"),
                                                },
                                            }}
                                            render={({ field }) => (
                                                <FormItem >
                                                    <FormControl>
                                                        <InputOTP pattern={REGEXP_ONLY_DIGITS} maxLength={6} {...field}>
                                                            <InputOTPGroup className="mx-auto">
                                                                <InputOTPSlot className="p-6 text-md" index={0} />
                                                                <InputOTPSlot className="p-6 text-md" index={1} />
                                                                <InputOTPSlot className="p-6 text-md" index={2} />
                                                                <InputOTPSlot className="p-6 text-md" index={3} />
                                                                <InputOTPSlot className="p-6 text-md" index={4} />
                                                                <InputOTPSlot className="p-6 text-md" index={5} />
                                                            </InputOTPGroup>
                                                        </InputOTP>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="flex flex-col-reverse gap-4">
                                            <Button
                                                type="button"
                                                variant='secondary'
                                                className="cursor-pointer px-3"
                                                onClick={() => api.scrollPrev()}
                                                disabled={isVerifingOtp}
                                            >

                                                {t("pages.forgotPasswordPage.back")}
                                            </Button>
                                            <Button
                                                type="submit"
                                                className="cursor-pointer px-3"
                                                disabled={isVerifingOtp}
                                            >
                                                {isVerifingOtp ? <Spinner /> : t("pages.forgotPasswordPage.stepTwo.submit")}
                                            </Button>
                                        </div>
                                    </form>
                                </FormProvider>
                            </CardContent>
                            <CardFooter className="pb-2">
                                <div className="sm:flex text-center justify-between w-full">
                                    <p className="text-sm text-muted-foreground p-0 m-0">
                                        {t("pages.forgotPasswordPage.remembered")}
                                        <Button variant='link'>
                                            <NavLink to={'/login'}>{t("pages.forgotPasswordPage.login")}</NavLink>
                                        </Button>
                                    </p>
                                </div>
                            </CardFooter>
                        </Card>
                    </CarouselItem>
                    <CarouselItem key={3}>
                        <Card>
                            <CardHeader>
                                <CardTitle >
                                    {t("pages.forgotPasswordPage.stepThree.title")}
                                </CardTitle>
                                <p className="text-sm text-muted-foreground">
                                    {t("pages.forgotPasswordPage.stepThree.description")}
                                </p>
                            </CardHeader>
                            <CardContent className="p-6">
                                <FormProvider {...stepThreeForm}>
                                    <form onSubmit={stepThreeForm.handleSubmit(formData => handleStep(formData, 3))} className="space-y-4">
                                        <FormField
                                            name="password"
                                            control={stepThreeForm.control}
                                            rules={{
                                                required: t("pages.forgotPasswordPage.stepThree.passwordRequired"),
                                                minLength: {
                                                    value: 8,
                                                    message: t("pages.forgotPasswordPage.stepThree.minLength"),
                                                },
                                                maxLength: {
                                                    value: 30,
                                                    message: t("pages.forgotPasswordPage.stepThree.maxLength"),
                                                },
                                                validate: {
                                                    hasLowercase: (value) =>
                                                        /[a-z]/.test(value) ||
                                                        t("pages.forgotPasswordPage.stepThree.lowercase"),
                                                    hasUppercase: (value) =>
                                                        /[A-Z]/.test(value) ||
                                                        t("pages.forgotPasswordPage.stepThree.uppercase"),
                                                    hasNumber: (value) =>
                                                        /[0-9]/.test(value) ||
                                                        t("pages.forgotPasswordPage.stepThree.number"),
                                                    hasSpecial: (value) =>
                                                        /[!@#$%^&*]/.test(value) ||
                                                        t("pages.forgotPasswordPage.stepThree.special"),
                                                },
                                            }}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="relative">
                                                        <InputLabel  {...field} placeholder=" " type={showPassword ? "text" : "password"} >{t("pages.forgotPasswordPage.stepThree.newPassword")}</InputLabel>
                                                        {showPassword ? <Eye onClick={() => setShowPassword(show => !show)} className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} /> : <EyeOff onClick={() => setShowPassword(show => !show)} className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} />}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            name="confirmPassword"
                                            control={stepThreeForm.control}
                                            rules={{
                                                required: t("pages.forgotPasswordPage.stepThree.passwordRequired"),
                                                validate: (value) =>
                                                    value === stepThreeForm.getValues("password") || t("pages.forgotPasswordPage.stepThree.notMatch"),
                                            }}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="relative">
                                                        <InputLabel {...field} placeholder=" " type={showPassword ? "text" : "password"} >{t("pages.forgotPasswordPage.stepThree.confirmPassword")}</InputLabel>
                                                        {showPassword ? <Eye onClick={() => setShowPassword(show => !show)} className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} /> : <EyeOff onClick={() => setShowPassword(show => !show)} className={`absolute top-3 ${isRight ? 'right-3' : "left-3"}`} />}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <Button
                                            type="submit"
                                            className="cursor-pointer w-full px-3 py-1"
                                            disabled={isUpdatingPassword}

                                        >
                                            {isUpdatingPassword ? <Spinner /> : t("pages.forgotPasswordPage.stepThree.resetPassword")}
                                        </Button>
                                    </form>
                                </FormProvider>
                            </CardContent>
                            <CardFooter>
                                <div className="sm:flex text-center justify-between w-full">
                                    <p className="text-sm text-muted-foreground p-0 m-0">
                                        {t("pages.forgotPasswordPage.remembered")}
                                        <Button variant='link'>
                                            <NavLink to={'/login'}>{t("pages.forgotPasswordPage.login")}</NavLink>
                                        </Button>
                                    </p>
                                </div>
                            </CardFooter>
                        </Card>
                    </CarouselItem>
                </CarouselContent>
            </Carousel>
        </div >

    )
}

export default ForgotPassword
