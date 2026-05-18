"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useTheme } from "next-themes"

// BIP Brand: Sky Blue RGB
const ACCENT = "70,188,223"
// Lines need more color punch than dots — brighter in dark, deeper in light
const LINE_COLOR_DARK = "140,220,245"   // bright white-cyan
const LINE_COLOR_LIGHT = "0,80,180"     // saturated blue

type Particle = {
  x: number
  y: number
  baseX: number
  baseY: number
  vx: number
  vy: number
  size: number
  baseOpacity: number
  phase: number
}

type IntensityConfig = {
  spacing: number
  jitter: number
  repelRadius: number
  repelStrength: number
  connectionRadius: number
  glowRadius: number
  opacityRange: [number, number] // [min, max] for baseOpacity
  lineBaseAlpha: number
  lineMouseBoost: number
  dotGlowMultiplier: number
  showRadialGradient: boolean
}

const FULL_CONFIG: IntensityConfig = {
  spacing: 72,
  jitter: 24,
  repelRadius: 130,
  repelStrength: 9,
  connectionRadius: 140,
  glowRadius: 200,
  opacityRange: [0.15, 0.5],
  lineBaseAlpha: 0.18,
  lineMouseBoost: 0.35,
  dotGlowMultiplier: 0.8,
  showRadialGradient: true,
}

const AMBIENT_CONFIG: IntensityConfig = {
  spacing: 95,
  jitter: 20,
  repelRadius: 120,
  repelStrength: 7,
  connectionRadius: 130,
  glowRadius: 170,
  opacityRange: [0.08, 0.22],
  lineBaseAlpha: 0.12,
  lineMouseBoost: 0.25,
  dotGlowMultiplier: 0.55,
  showRadialGradient: false,
}

// Light mode reduces all opacity values
const LIGHT_MULTIPLIER = 0.8

function getEnabled(): boolean {
  if (typeof window === "undefined") return true
  const stored = localStorage.getItem("particles-enabled")
  return stored !== "false"
}

function isMobileOrNoPointer(): boolean {
  if (typeof window === "undefined") return false
  // No hover capability (touch-only device)
  if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return true
  // Small screen
  if (window.innerWidth < 768) return true
  return false
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

interface ParticleBackgroundProps {
  intensity: "full" | "ambient"
}

export function ParticleBackground({ intensity }: ParticleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999 })
  const raf = useRef<number>(0)
  const { resolvedTheme } = useTheme()
  const [enabled, setEnabled] = useState(true)
  const [mobile, setMobile] = useState(false)

  // Listen for preference changes from settings toggle
  useEffect(() => {
    setEnabled(getEnabled())
    setMobile(isMobileOrNoPointer())

    const onPrefChange = () => setEnabled(getEnabled())
    const onResize = () => setMobile(isMobileOrNoPointer())

    window.addEventListener("particles-preference-changed", onPrefChange)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("particles-preference-changed", onPrefChange)
      window.removeEventListener("resize", onResize)
    }
  }, [])

  // Stable reference to resolvedTheme for the animation loop
  const themeRef = useRef(resolvedTheme)
  useEffect(() => {
    themeRef.current = resolvedTheme
  }, [resolvedTheme])

  const startAnimation = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let particles: Particle[] = []
    let W = 0
    let H = 0
    const config = intensity === "full" ? FULL_CONFIG : AMBIENT_CONFIG
    const reducedMotion = prefersReducedMotion()

    function buildParticles() {
      particles = []
      const cols = Math.ceil(W / config.spacing) + 1
      const rows = Math.ceil(H / config.spacing) + 1
      const [minOp, maxOp] = config.opacityRange

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const bx = c * config.spacing + (Math.random() - 0.5) * config.jitter
          const by = r * config.spacing + (Math.random() - 0.5) * config.jitter
          particles.push({
            x: bx,
            y: by,
            baseX: bx,
            baseY: by,
            vx: 0,
            vy: 0,
            size: Math.random() * 1.6 + 0.8,
            baseOpacity: Math.random() * (maxOp - minOp) + minOp,
            phase: Math.random() * Math.PI * 2,
          })
        }
      }
    }

    function resize() {
      const parent = canvas!.parentElement
      if (!parent) return
      W = parent.clientWidth
      H = parent.clientHeight
      canvas!.width = W
      canvas!.height = H
      buildParticles()
    }

    let tick = 0
    function frame() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, W, H)
      tick++

      const isDark = themeRef.current === "dark"
      const opMult = isDark ? 1 : LIGHT_MULTIPLIER
      const lineColor = isDark ? LINE_COLOR_DARK : LINE_COLOR_LIGHT
      const { x: mx, y: my } = mouse.current

      // --- Update positions ---
      if (!reducedMotion) {
        for (const p of particles) {
          // Ambient float
          const floatX = Math.sin(p.phase + tick * 0.007) * 3
          const floatY = Math.cos(p.phase * 1.3 + tick * 0.005) * 3
          const targetX = p.baseX + floatX
          const targetY = p.baseY + floatY

          // Mouse repulsion
          const dx = mx - p.x
          const dy = my - p.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          let fx = 0
          let fy = 0
          if (dist < config.repelRadius && dist > 0) {
            const force = (1 - dist / config.repelRadius) * config.repelStrength
            fx = -(dx / dist) * force * 6
            fy = -(dy / dist) * force * 6
          }

          // Spring back toward float target + repel offset
          p.vx += (targetX + fx - p.x) * 0.07
          p.vy += (targetY + fy - p.y) * 0.07
          p.vx *= 0.72 // damping
          p.vy *= 0.72
          p.x += p.vx
          p.y += p.vy
        }
      }

      // --- Draw connecting lines ---
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]!
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d >= config.connectionRadius) continue

          const midX = (a.x + b.x) / 2
          const midY = (a.y + b.y) / 2
          const mdx = mx - midX
          const mdy = my - midY
          const md = Math.sqrt(mdx * mdx + mdy * mdy)
          const mouseBoost =
            !reducedMotion && md < config.glowRadius
              ? (1 - md / config.glowRadius) * config.lineMouseBoost
              : 0
          const alpha = ((1 - d / config.connectionRadius) * config.lineBaseAlpha + mouseBoost) * opMult

          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = `rgba(${lineColor},${alpha})`
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
      }

      // --- Draw dots ---
      for (const p of particles) {
        const dx = mx - p.x
        const dy = my - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const glow =
          !reducedMotion && dist < config.glowRadius
            ? (1 - dist / config.glowRadius) * config.dotGlowMultiplier
            : 0
        const opacity = (p.baseOpacity + glow) * opMult
        const size = p.size + glow * 2

        // Soft radial halo near cursor
        if (glow > 0.05) {
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4)
          grad.addColorStop(0, `rgba(${ACCENT},${glow * 0.18 * opMult})`)
          grad.addColorStop(1, `rgba(${ACCENT},0)`)
          ctx.beginPath()
          ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${ACCENT},${Math.min(opacity, 0.9)})`
        ctx.fill()
      }

      raf.current = requestAnimationFrame(frame)
    }

    resize()
    frame()

    // Mouse handlers — use canvas bounding rect for correct coords in positioned containers
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onLeave = () => {
      mouse.current = { x: -9999, y: -9999 }
    }

    const resizeObserver = new ResizeObserver(resize)
    const parent = canvas.parentElement
    if (parent) resizeObserver.observe(parent)

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseleave", onLeave)

    return () => {
      cancelAnimationFrame(raf.current)
      resizeObserver.disconnect()
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
    }
  }, [intensity])

  // Start/stop animation when enabled or theme changes
  useEffect(() => {
    if (!enabled || mobile) return
    const cleanup = startAnimation()
    return cleanup
  }, [enabled, mobile, resolvedTheme, startAnimation])

  if (!enabled || mobile) return null

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 z-0"
        style={{ pointerEvents: "none" }}
      />
      {/* Subtle center radial glow overlay — full intensity only */}
      {intensity === "full" && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 50% at 50% 50%, rgba(${ACCENT},0.05) 0%, transparent 70%)`,
          }}
        />
      )}
    </>
  )
}
