import { useEffect, useRef, useState } from "react"

// Fades and lifts its children in the first time they scroll into view.
function Reveal({ children, delay = 0, className = "" }) {
    const ref = useRef()
    const [shown, setShown] = useState(false)

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) { setShown(true); observer.disconnect() }
        }, { threshold: 0.15 })
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [])

    return <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
        className={`transition-all duration-700 ${shown ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"} ${className}`}>
        {children}
    </div>
}

export default Reveal
