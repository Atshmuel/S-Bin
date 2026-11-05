import { useEffect, useState } from "react";

// The height from an element's top (on the page, at no scroll) to the bottom
// of the window, less `bottomGap`, at least `minHeight` and `minViewportRatio` of
// the window (a phone, where the content above can leave no room): a panel this tall fills
// what is left of the screen and scrolls inside itself instead of the page.
// Returns [ref, height]: the ref is a callback, so an element that appears
// later (after its data loads) is measured too. Measured again when the window
// or anything above it changes size.
export function useRemainingHeight({ bottomGap = 16, minHeight = 320, minViewportRatio = 0 } = {}) {
    const [element, setElement] = useState(null);
    const [height, setHeight] = useState(null);
    useEffect(() => {
        if (!element) return;
        const measure = () => {
            const top = element.getBoundingClientRect().top + window.scrollY;
            setHeight(Math.max(Math.floor(window.innerHeight - top - bottomGap), minHeight, Math.floor(window.innerHeight * minViewportRatio)));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(document.body);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [element, bottomGap, minHeight, minViewportRatio]);
    return [setElement, height];
}
