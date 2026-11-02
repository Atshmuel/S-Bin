import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { ContactShadows, Environment, Html, Lightformer, Line, useGLTF, useProgress } from "@react-three/drei"
import * as THREE from "three"
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { FILL_END, cameraAt, clamp01, ease, fillAt, fillColor, seg, story, weightAt } from "./story"

const MODELS = { bin: "/models/bin-v2.glb", device: "/models/device.glb" }
Object.values(MODELS).forEach(url => useGLTF.preload(url))

// ---------------------------------------------------------------- materials
const blue = { color: "#1f5bbd", roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3 }
const MATERIALS = {
    lid: new THREE.MeshPhysicalMaterial({ ...blue, color: "#2466c9", side: THREE.DoubleSide }),
    hatch: new THREE.MeshPhysicalMaterial({ color: "#26292d", roughness: 0.45, metalness: 0.1 }),
    screws: new THREE.MeshStandardMaterial({ color: "#b9bec4", roughness: 0.35, metalness: 0.9 }),
    axle: new THREE.MeshStandardMaterial({ color: "#8a8d91", roughness: 0.4, metalness: 0.8 }),
    plate: new THREE.MeshStandardMaterial({ color: "#3b4046", roughness: 0.7 }),
    skirt: new THREE.MeshStandardMaterial({ color: "#2b2f34", roughness: 0.85 }),
    wheels: new THREE.MeshStandardMaterial({ color: "#161616", roughness: 0.9 }),
    base: new THREE.MeshPhysicalMaterial({ color: "#34373b", roughness: 0.5, clearcoat: 0.3 }),
}
MATERIALS.bodyShared = new THREE.MeshPhysicalMaterial(blue)

// The model's meshes with smooth shading across soft edges only; the bin is
// drawn several times, so each geometry is smoothed once.
const smoothed = new WeakMap()
function smooth(geometry) {
    if (!smoothed.has(geometry)) smoothed.set(geometry, toCreasedNormals(geometry, Math.PI / 6))
    return smoothed.get(geometry)
}

function useParts(url) {
    const { nodes } = useGLTF(url)
    return useMemo(() => Object.fromEntries(
        Object.entries(nodes).filter(([, node]) => node.isMesh).map(([name, node]) => [name, smooth(node.geometry)])
    ), [nodes])
}

// ---------------------------------------------------------------- the bin
// The lid turns on its hinge at the back wall (z < 0 is the back, where the
// hatch is). `bodyMaterial` lets one bin fade to glass while the others stay.
function BinModel({ bodyMaterial = MATERIALS.bodyShared, lidRef }) {
    const parts = useParts(MODELS.bin)
    const hinge = [0, 0.908, -0.268]
    return <group>
        <mesh geometry={parts.body} material={bodyMaterial} />
        <group ref={lidRef} position={hinge}>
            <mesh geometry={parts.lid} material={MATERIALS.lid} position={[0, -hinge[1], -hinge[2]]} />
        </group>
        {["hatch", "screws", "plate", "skirt", "axle", "wheels"].map(name =>
            <mesh key={name} geometry={parts[name]} material={MATERIALS[name]} />)}
    </group>
}

function DeviceModel() {
    const parts = useParts(MODELS.device)
    return <group>
        <mesh geometry={parts.base} material={MATERIALS.base} />
        <mesh geometry={parts.lid} material={MATERIALS.base} />
        <mesh geometry={parts.screws} material={MATERIALS.screws} />
    </group>
}

// ---------------------------------------------------------------- waste
// The inside of the bin as a tapered, rounded block; a clip plane cuts it at the fill level.
const IN = { y0: 0.034, y1: 0.89, wb: 0.352, db: 0.372, wt: 0.416, dt: 0.456, rb: 0.03, rt: 0.04 }

// One lumpy bin bag.
function bagGeometry() {
    const g = new THREE.SphereGeometry(0.135, 40, 28)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
        const k = 1 + 0.12 * Math.sin(p.getX(i) * 31) * Math.cos(p.getZ(i) * 27 + p.getY(i) * 11)
        p.setXYZ(i, p.getX(i) * k * 1.05, p.getY(i) * k * 0.9, p.getZ(i) * k * 1.05)
    }
    g.computeVertexNormals()
    return g
}

// The bags that fill the bin, in layers from the floor, each with its own size and turn.
const BAG_TONES = ["#15181c", "#1c1f24", "#2a2e35", "#3a4048", "#8a9099"].map(c => new THREE.Color(c))
const BAGS = (() => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const list = []
    for (let layer = 0; ; layer++) {
        const y = IN.y0 + 0.08 + layer * 0.11
        if (y > IN.y1 - 0.12) break
        const t = (y - IN.y0) / (IN.y1 - IN.y0)
        const w = THREE.MathUtils.lerp(IN.wb, IN.wt, t) - 0.16, d = THREE.MathUtils.lerp(IN.db, IN.dt, t) - 0.16
        const cols = Math.max(2, Math.round(w / 0.14)), rows = Math.max(2, Math.round(d / 0.14))
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) list.push({
            x: ((i + 0.5) / cols - 0.5) * w + (rnd() - 0.5) * 0.03,
            y: y + (rnd() - 0.5) * 0.02,
            z: ((j + 0.5) / rows - 0.5) * d + (rnd() - 0.5) * 0.03,
            s: 0.62 + rnd() * 0.14, turn: rnd() * 6.28, tone: BAG_TONES[Math.floor(rnd() * BAG_TONES.length)],
        })
    }
    return list
})()

function Waste({ fillRef }) {
    const geometry = useMemo(bagGeometry, [])
    const bags = useRef()
    const dummy = useMemo(() => new THREE.Object3D(), [])
    useEffect(() => { BAGS.forEach((bag, i) => bags.current.setColorAt(i, bag.tone)); bags.current.instanceColor.needsUpdate = true }, [])

    // Called every frame by the scene with the fill level (0..1): the bags up to that level pop in.
    fillRef.current = level => {
        const y = IN.y0 + level * (IN.y1 - IN.y0)
        BAGS.forEach((bag, i) => {
            const pop = seg(y, bag.y - 0.04, bag.y + 0.06)
            dummy.position.set(bag.x, bag.y, bag.z)
            dummy.rotation.set(0, bag.turn, 0)
            dummy.scale.setScalar(Math.max(bag.s * pop, 0.0001))
            dummy.updateMatrix()
            bags.current.setMatrixAt(i, dummy.matrix)
        })
        bags.current.instanceMatrix.needsUpdate = true
        bags.current.visible = level > 0.01
    }
    return <>
        <instancedMesh ref={bags} args={[geometry, undefined, BAGS.length]} frustumCulled={false}>
            <meshPhysicalMaterial roughness={0.28} clearcoat={0.9} />
        </instancedMesh>
    </>
}

// The bag that drops in when the lid opens.
function Bag({ groupRef }) {
    const geometry = useMemo(bagGeometry, [])
    return <group ref={groupRef} visible={false}>
        <mesh geometry={geometry}><meshPhysicalMaterial color="#1c1f24" roughness={0.25} clearcoat={1} /></mesh>
        <mesh position={[0, 0.14, 0]}><coneGeometry args={[0.03, 0.07, 14]} /><meshPhysicalMaterial color="#1c1f24" roughness={0.25} clearcoat={1} /></mesh>
    </group>
}

// ---------------------------------------------------------------- effects
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }

function Rings({ count, radius, color, setRef, y = 0 }) {
    return Array.from({ length: count }, (_, i) =>
        <mesh key={i} ref={setRef(i)} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[radius * 0.97, radius, 64]} />
            <meshBasicMaterial color={color} {...additive} />
        </mesh>)
}

function Truck({ groupRef, accent }) {
    return <group ref={groupRef} visible={false}>
        <mesh position={[-0.05, 0.36, 0]}><boxGeometry args={[0.78, 0.46, 0.46]} /><meshStandardMaterial color="#e8edf0" roughness={0.5} /></mesh>
        <mesh position={[0.5, 0.31, 0]}><boxGeometry args={[0.28, 0.36, 0.44]} /><meshStandardMaterial color={accent} roughness={0.45} /></mesh>
        <mesh position={[0.1, 0.1, 0]}><boxGeometry args={[1.0, 0.1, 0.4]} /><meshStandardMaterial color="#25282c" /></mesh>
        {[[-0.32, 0.23], [0.4, 0.23], [-0.32, -0.23], [0.4, -0.23]].map(([x, z], i) =>
            <mesh key={i} position={[x, 0.09, z]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.09, 0.09, 0.07, 20]} /><meshStandardMaterial color="#141414" roughness={0.9} />
            </mesh>)}
    </group>
}

// A small label that floats beside a thing in the scene; the scene sets its text and opacity.
function Chip({ position, chipRef, tone }) {
    return <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div ref={chipRef} style={{ opacity: 0 }}
            className={`rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap backdrop-blur-md ${tone}`} />
    </Html>
}

// ---------------------------------------------------------------- the world
// Readings that float around the bin in the opening shot.
const HERO_CHIPS = [
    { key: "fill", position: [0.42, 0.78, 0.3], tone: "border-amber-300/40 bg-black/50 text-amber-200" },
    { key: "weight", position: [-0.62, 0.5, 0.35], tone: "border-white/25 bg-black/50 text-white" },
    { key: "live", position: [0.5, 0.18, 0.3], tone: "border-emerald-300/40 bg-black/50 text-emerald-200" },
]
const FLEET = [
    { pos: [-3.2, 0, -0.8], level: 0.91 },
    { pos: [-1.6, 0, 0.6], level: 0.45 },
    { pos: [0, 0, 0], level: FILL_END },
    { pos: [1.7, 0, 0.8], level: 0.22 },
    { pos: [3.3, 0, -0.5], level: 0.88 },
]
// The street scene is drawn narrower on a phone (`squeeze` of the x spread) so the bins stay big enough to see.
const squeezed = (points, squeeze) => points.map(([x, y, z]) => new THREE.Vector3(x * squeeze, y, z))
const makeRoute = squeeze => new THREE.CatmullRomCurve3(squeezed([
    [-4.9, 0.03, 1.5], [-3.2, 0.03, 0.55], [-1.5, 0.03, 1.6], [0, 0.03, 0.95],
    [1.7, 0.03, 1.9], [3.3, 0.03, 0.6], [4.9, 0.03, 1.4],
], squeeze))
// the fixed round: every bin, in order, whether it needs emptying or not
const makeDefaultRoute = squeeze => new THREE.CatmullRomCurve3(squeezed([
    [-4.9, 0.02, 1.8], [-3.3, 0.02, 0.45], [-2.6, 0.02, 2.0], [-1.6, 0.02, 1.6], [-0.8, 0.02, 0.2], [0, 0.02, 1.0],
    [0.9, 0.02, 2.1], [1.7, 0.02, 1.9], [2.5, 0.02, 0.3], [3.3, 0.02, 0.6], [4.0, 0.02, 2.1], [4.9, 0.02, 1.4],
], squeeze)).getPoints(160)

// The system's primary colour as the scene needs it, following the light and dark theme.
function usePrimary() {
    const [colour, setColour] = useState("rgb(0, 201, 80)")
    useEffect(() => {
        const read = () => {
            const value = getComputedStyle(document.body).getPropertyValue("--primary").trim()
            const context = document.createElement("canvas").getContext("2d")
            context.fillStyle = "#010203"
            context.fillStyle = value
            if (context.fillStyle === "#010203") return
            context.fillRect(0, 0, 1, 1)
            const [r, g, b] = context.getImageData(0, 0, 1, 1).data
            setColour(`rgb(${r}, ${g}, ${b})`)
        }
        read()
        const observer = new MutationObserver(read)
        observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
        return () => observer.disconnect()
    }, [])
    return colour
}

function World({ labels, direction, mobile }) {
    const accent = usePrimary()
    const squeeze = mobile ? 0.5 : 1
    const route = useMemo(() => makeRoute(squeeze), [squeeze])
    const routePoints = useMemo(() => route.getPoints(120), [route])
    const defaultRoutePoints = useMemo(() => makeDefaultRoute(squeeze), [squeeze])
    const streetPos = pos => [pos[0] * squeeze, pos[1], pos[2]]
    const { camera, size } = useThree()
    const fillRef = useRef(), lidRef = useRef(), bagRef = useRef(), binRef = useRef()
    const deviceRef = useRef(), truckRef = useRef(), beamRef = useRef(), routeRef = useRef(), defaultRouteRef = useRef()
    const cloneRefs = useRef([]), beaconRefs = useRef([]), fleetChips = useRef([])
    const groundRings = useRef([]), airRings = useRef([]), scanRings = useRef([])
    const weightChip = useRef(), fillChip = useRef(), heroChips = useRef([])
    const binPivot = useRef(), devPivot = useRef()
    const spin = useRef({ bin: { yaw: 0, pitch: 0 }, device: { yaw: 0, pitch: 0 }, drag: null, last: -10 })
    const bodyMaterial = useMemo(() => MATERIALS.bodyShared.clone(), [])
    const look = useMemo(() => new THREE.Vector3(), [])

    // In the line-up the visitor can turn each model: drag to spin, and it drifts round by itself when left alone.
    const { gl } = useThree()
    const startDrag = (key, event) => {
        if (story.p < 0.93) return
        event.stopPropagation()
        spin.current.drag = { key, x: event.clientX, y: event.clientY }
        gl.domElement.style.cursor = "grabbing"
    }
    const hoverTurn = () => { if (story.p >= 0.93) gl.domElement.style.cursor = "grab" }
    const leaveTurn = () => { if (!spin.current.drag) gl.domElement.style.cursor = "" }
    useEffect(() => {
        const move = event => {
            const drag = spin.current.drag
            if (!drag) return
            const model = spin.current[drag.key]
            model.yaw += (event.clientX - drag.x) * 0.012
            model.pitch = THREE.MathUtils.clamp(model.pitch + (event.clientY - drag.y) * 0.008, -0.6, 0.9)
            drag.x = event.clientX; drag.y = event.clientY
        }
        const end = () => { spin.current.drag = null; gl.domElement.style.cursor = "" }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", end)
        window.addEventListener("pointercancel", end)
        return () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", end)
            window.removeEventListener("pointercancel", end)
        }
    }, [gl])
    const ringRef = list => i => el => { list.current[i] = el }

    useFrame((state, delta) => {
        const time = state.clock.elapsedTime
        story.p = THREE.MathUtils.damp(story.p, story.raw, 4.5, delta)
        const p = story.p

        // camera
        const cam = cameraAt(p)
        const hero = 1 - seg(p, 0.06, 0.14)
        // the wide scenes need the camera further back on a narrow screen
        const aspect = size.width / size.height
        const spread = THREE.MathUtils.clamp(aspect / 1.7, 0.42, 1)
        const dist = Math.hypot(...cam.pos.map((v, n) => v - cam.look[n]))
        const street = (mobile ? 5.6 : 4.2) * squeeze
        const need = aspect < 1.2 ? THREE.MathUtils.lerp(street, 1.2 * spread + 0.8, seg(p, 0.86, 0.93)) : street * (1 - seg(p, 0.86, 0.93))
        // on a phone the first chapters stand further back so the bin fits above the text
        const phone = mobile ? 1 + 0.8 * (1 - seg(p, 0.7, 0.75)) : 1
        const back = (1 + seg(p, 0.72, 0.77) * (THREE.MathUtils.clamp(need / (0.287 * dist * aspect), 1, 2.8) - 1)) * phone
        camera.position.set(
            cam.look[0] + (cam.pos[0] - cam.look[0]) * back + state.pointer.x * 0.12 + Math.sin(time * 0.25) * 0.08 * hero,
            cam.look[1] + (cam.pos[1] - cam.look[1]) * back + state.pointer.y * 0.06,
            cam.look[2] + (cam.pos[2] - cam.look[2]) * back)
        camera.lookAt(look.set(...cam.look))
        const shift = mobile ? 0 : cam.shift * direction
        const lift = mobile ? cam.phoneLift : cam.lift
        camera.setViewOffset(size.width, size.height, -shift * size.width, lift * size.height, size.width, size.height)

        // the bin steps aside and turns a little towards the device in the line-up
        const lineup = seg(p, 0.86, 0.93)
        binRef.current.position.x = -1.3 * spread * lineup * direction
        binRef.current.rotation.y = (0.45 * lineup + Math.sin(time * 0.4) * 0.05 * lineup) * direction

        const heroShown = 1 - seg(p, 0.03, 0.09)
        const heroText = [`${labels.fill}  ${Math.round(FILL_END * 100)}%`, `${labels.weight}  46.8 kg`, `● ${labels.live}`]
        heroChips.current.forEach((chip, i) => {
            if (!chip) return
            chip.style.opacity = mobile ? 0 : heroShown
            chip.style.transform = `translateY(${Math.sin(time * 1.1 + i * 2) * 5}px)`
            chip.textContent = heroText[i]
        })

        // lid, bag, weight
        const open = seg(p, 0.13, 0.17) * (1 - seg(p, 0.285, 0.32))
        lidRef.current.rotation.x = -1.9 * open
        const fall = seg(p, 0.165, 0.235)
        bagRef.current.visible = p > 0.15 && p < 0.5
        bagRef.current.position.set(0, 1.9 - 1.78 * fall, 0)
        bagRef.current.rotation.set(fall * 1.2, fall * 2.4, 0)
        bagRef.current.scale.setScalar(0.62 * (1 - 0.15 * seg(p, 0.23, 0.26)))

        const weightShown = seg(p, 0.19, 0.22) * (1 - seg(p, 0.52, 0.56))
        weightChip.current.style.opacity = weightShown
        weightChip.current.textContent = `${labels.weight}  ${weightAt(p).toFixed(1)} kg`

        // ground ripple where the weight lands
        const land = seg(p, 0.232, 0.31)
        groundRings.current.forEach((ring, i) => {
            const t = clamp01(land * 1.4 - i * 0.2)
            ring.visible = t > 0 && t < 1
            ring.scale.setScalar(0.35 + 1.1 * t)
            ring.material.opacity = (1 - t) * 0.8
        })

        // glass bin, the level rising, a sensor's pulses falling to it
        const glass = seg(p, 0.325, 0.355) * (1 - seg(p, 0.5, 0.53))
        bodyMaterial.transparent = glass > 0.001
        bodyMaterial.opacity = 1 - 0.82 * glass
        bodyMaterial.depthWrite = glass < 0.5
        const level = fillAt(p)
        fillRef.current(level)
        fillChip.current.style.opacity = seg(p, 0.35, 0.38) * (1 - seg(p, 0.52, 0.56))
        fillChip.current.textContent = `${labels.fill}  ${Math.round(level * 100)}%`
        const surface = IN.y0 + level * (IN.y1 - IN.y0)
        scanRings.current.forEach((ring, i) => {
            const t = (time * 0.6 + i / 3) % 1
            ring.visible = glass > 0.5 && level > 0.2
            ring.position.y = THREE.MathUtils.lerp(0.78, surface, t)
            ring.material.opacity = Math.sin(t * Math.PI) * 0.7 * glass
        })

        // it tells the world
        const talk = seg(p, 0.54, 0.58) * (1 - seg(p, 0.71, 0.745))
        airRings.current.forEach((ring, i) => {
            const t = (time * 0.4 + i / 5) % 1
            ring.visible = talk > 0.01
            ring.position.y = 0.98 + t * 2.1
            ring.scale.setScalar(0.4 + t * 0.9)
            ring.material.opacity = (1 - t) * 0.8 * talk
        })
        beamRef.current.visible = talk > 0.01
        beamRef.current.scale.y = Math.max(talk, 0.001)
        beamRef.current.position.y = 0.96 + talk * 1.05

        // the fleet and the route
        const fleet = seg(p, 0.72, 0.79) * (1 - seg(p, 0.84, 0.885))
        FLEET.forEach((bin, i) => {
            const group = cloneRefs.current[i]
            if (!group) return
            const s = ease(clamp01(fleet * 1.6 - (Math.abs(i - 2) * 0.15)))
            group.scale.setScalar(Math.max(s, 0.001)); group.visible = s > 0.002
        })
        const stage = seg(p, 0.745, 0.79) * (1 - seg(p, 0.84, 0.885))
        FLEET.forEach((bin, i) => {
            const flagged = bin.level >= 0.7
            const beacon = beaconRefs.current[i]
            beacon.visible = stage > 0.01
            beacon.scale.setScalar(stage * (flagged ? 1 + 0.18 * Math.sin(time * 4 + i) : 0.8))
            const chip = fleetChips.current[i]
            chip.style.opacity = stage
        })
        // first the default round, then the route sBin would give instead
        const best = stage * seg(p, 0.795, 0.825)
        defaultRouteRef.current.visible = stage > 0.01
        defaultRouteRef.current.material.opacity = stage * (1 - 0.65 * seg(p, 0.795, 0.825))
        defaultRouteRef.current.material.dashOffset -= delta * 0.2
        routeRef.current.visible = best > 0.01
        routeRef.current.material.opacity = best
        routeRef.current.material.dashOffset -= delta * 0.4
        const drive = seg(p, 0.815, 0.88)
        truckRef.current.visible = best > 0.01
        const at = route.getPointAt(Math.min(drive, 0.999)), ahead = route.getTangentAt(Math.min(drive, 0.999))
        truckRef.current.position.copy(at).setY(0)
        truckRef.current.rotation.y = Math.atan2(-ahead.z, ahead.x)
        truckRef.current.scale.setScalar(best * 0.62)

        // the line-up
        const others = seg(p, 0.885, 0.94)
        deviceRef.current.visible = others > 0.002
        deviceRef.current.scale.setScalar(5 * Math.max(others, 0.001))
        deviceRef.current.position.set(1.3 * spread * direction, 0.42 + Math.sin(time * 0.8) * 0.015, 0)

        // turning the models
        const turn = spin.current
        const interactive = p > 0.93
        ;[["bin", binPivot, 1], ["device", devPivot, -1]].forEach(([key, pivot, way]) => {
            const model = turn[key]
            if (!interactive) {
                model.yaw = THREE.MathUtils.damp(model.yaw, Math.round(model.yaw / (2 * Math.PI)) * 2 * Math.PI, 3, delta)
                model.pitch = THREE.MathUtils.damp(model.pitch, 0, 3, delta)
            } else if (turn.drag?.key === key) turn.last = time
            else if (time - turn.last > 2.5) model.yaw += delta * 0.4 * way
            pivot.current.rotation.set(model.pitch, model.yaw, 0)
        })
    })

    return <>
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 5, 3]} intensity={1.2} />
        <Environment resolution={256} frames={1}>
            <Lightformer form="rect" intensity={2.6} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
            <Lightformer form="rect" intensity={2} position={[-5, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#cfe9ff" />
            <Lightformer form="rect" intensity={2.2} position={[5, 1.5, -3]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} color="#b6f5a8" />
            <Lightformer form="ring" intensity={1.4} position={[0, 2, -6]} scale={5} />
        </Environment>

        <group ref={binRef}>
          <group ref={binPivot} position={[0, 0.46, 0]} rotation-order="YXZ"
            onPointerDown={event => startDrag("bin", event)} onPointerOver={hoverTurn} onPointerOut={leaveTurn}>
           <group position={[0, -0.46, 0]}>
            <BinModel bodyMaterial={bodyMaterial} lidRef={lidRef} />
            <Waste fillRef={fillRef} />
            <Bag groupRef={bagRef} />
            <Rings count={3} radius={0.2} color="#7dd3fc" setRef={ringRef(scanRings)} />
            <Chip position={[mobile ? 0 : 0.5, 0.42, mobile ? 0.3 : 0]} chipRef={weightChip} tone="border-white/25 bg-black/50 text-white" />
            <Chip position={[mobile ? 0 : -0.5, 0.85, mobile ? 0.3 : 0]} chipRef={fillChip} tone="border-amber-300/40 bg-black/50 text-amber-200" />
           </group>
          </group>
        </group>
        {HERO_CHIPS.map(({ position, tone, key }, i) => <Chip key={key} position={position} chipRef={el => { heroChips.current[i] = el }} tone={tone} />)}

        <Rings count={3} radius={1} color={accent} y={0.012} setRef={ringRef(groundRings)} />
        <Rings count={5} radius={0.5} color={accent} setRef={ringRef(airRings)} />
        <mesh ref={beamRef} visible={false} position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 2.2, 8]} />
            <meshBasicMaterial color={accent} {...additive} opacity={0.5} />
        </mesh>

        {FLEET.map((bin, i) => i !== 2 && <group key={i} ref={el => { cloneRefs.current[i] = el }} position={streetPos(bin.pos)} visible={false}>
            <BinModel />
        </group>)}
        {FLEET.map((bin, i) => {
            const [r, g, b] = fillColor(bin.level)
            const color = new THREE.Color(r, g, b)
            return <group key={i} position={[bin.pos[0] * squeeze, 1.18, bin.pos[2]]}>
                <mesh ref={el => { beaconRefs.current[i] = el }} visible={false}>
                    <sphereGeometry args={[0.075, 20, 20]} />
                    <meshBasicMaterial color={color} toneMapped={false} />
                </mesh>
                <Html center position={[0, 0.22, 0]} style={{ pointerEvents: "none" }}>
                    <div ref={el => { fleetChips.current[i] = el }} style={{ opacity: 0, color: `rgb(${r * 255},${g * 255},${b * 255})` }}
                        className="rounded-full border border-white/20 bg-black/55 px-2.5 py-0.5 text-xs font-semibold backdrop-blur-md">
                        {Math.round(bin.level * 100)}%
                    </div>
                </Html>
            </group>
        })}
        <Line ref={defaultRouteRef} points={defaultRoutePoints} color="#94a3b8" lineWidth={2} dashed dashSize={0.1} gapSize={0.1} transparent />
        <Line ref={routeRef} points={routePoints} color={accent} lineWidth={3} dashed dashSize={0.18} gapSize={0.12} transparent />
        <Truck groupRef={truckRef} accent={accent} />

        <group ref={deviceRef} visible={false}>
            <group ref={devPivot} rotation-order="YXZ" onPointerDown={event => startDrag("device", event)} onPointerOver={hoverTurn} onPointerOut={leaveTurn}>
                <group rotation={[Math.PI / 2, 0, 0]}><DeviceModel /></group>
            </group>
        </group>

        <ContactShadows position={[0, 0, 0]} scale={16} far={2.2} blur={2.6} opacity={0.55} resolution={512} frames={1} />
    </>
}

// ---------------------------------------------------------------- canvas
function Loader() {
    const { progress, active } = useProgress()
    if (!active && progress >= 100) return null
    return <div className="absolute inset-x-0 top-1/2 z-10 mx-auto w-40 -translate-y-1/2 text-center text-xs text-white/60">
        <div className="mb-2 h-0.5 overflow-hidden rounded bg-white/15"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div>
        {Math.round(progress)}%
    </div>
}

export function SbinScene({ labels, direction, mobile, active }) {
    return <><Loader /><Canvas
        dpr={[1, 2]}
        frameloop={active ? "always" : "never"}
        style={{ touchAction: "pan-y" }}
        camera={{ fov: 32, near: 0.1, far: 60, position: [1.55, 1.1, -2.1] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}
    >
        <Suspense fallback={null}>
            <World labels={labels} direction={direction} mobile={mobile} />
        </Suspense>
    </Canvas></>
}
