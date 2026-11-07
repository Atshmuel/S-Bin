import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSideContext } from "./appSideContext";
import { browserLanguage, loadLanguage } from "@/i18n";

function AppSideProvider({ children }) {
    const { i18n } = useTranslation()
    const [isRight, setIsRight] = useState(true);
    const [side, setSide] = useState("right");
    const [opSide, setOpSide] = useState("left");

    const toggleSide = (lang) => {
        loadLanguage(lang)
        setIsRight(!isRight);
        setSide(isRight ? "left" : "right");
        setOpSide(isRight ? "right" : "left");

    }

    // Set initial side based on browser language
    useEffect(() => {
        const lang = browserLanguage();

        if (lang === "he") {
            toggleSide(lang)
            document.documentElement.lang = lang;
        }
        // Once, on load: toggleSide flips the side, so running it again would undo it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return <AppSideContext.Provider value={{ side, isRight, opSide, toggleSide, language: i18n.language }}>{children}</AppSideContext.Provider>
}

export { AppSideProvider }
