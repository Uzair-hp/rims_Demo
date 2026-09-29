/**
 * Ruchita Interiors — icon set.
 *
 * Hand-rolled 24x24 stroke icons so the shell has no icon-library dependency and
 * every glyph inherits `currentColor` from the surrounding text token (§18.4 —
 * icons never carry brand colour on their own).
 *
 * Icons are always decorative here: the accessible name comes from the visible
 * label or from `visually-hidden` text next to the icon.
 */

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`

/** @type {Record<string, { paths: string[], solid?: boolean }>} */
export const ICON_PATHS = {
  home: {
    paths: ['M3.2 10.7 12 3.3l8.8 7.4', 'M5.7 9.6V19a2 2 0 0 0 2 2H11v-5.4h2V21h3.3a2 2 0 0 0 2-2V9.6'],
  },
  fileText: {
    paths: [
      'M13.8 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.2z',
      'M13.8 3.2v5h5',
      'M9 13h6',
      'M9 16.6h4',
    ],
  },
  receipt: {
    paths: [
      'M6.2 3.2h11.6v17.6l-2.9-1.9-2.9 1.9-2.9-1.9-2.9 1.9z',
      'M9.4 8.4h5.2',
      'M9.4 12h5.2',
      'M9.4 15.6h3',
    ],
  },
  users: {
    paths: [
      circle(9.6, 8.2, 3.4),
      'M3.8 19.6v-1.1a4.4 4.4 0 0 1 4.4-4.4h2.8a4.4 4.4 0 0 1 4.4 4.4v1.1',
      'M16.4 14.3a4.4 4.4 0 0 1 3.8 4.3v1',
      'M15.6 5.1a3.4 3.4 0 0 1 0 6.2',
    ],
  },
  settings: {
    paths: [
      'M12.2 2.6h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2z',
      circle(12, 12, 3.2),
    ],
  },
  plus: { paths: ['M12 5.2v13.6', 'M5.2 12h13.6'] },
  plusCircle: { paths: [circle(12, 12, 8.4), 'M12 8.4v7.2', 'M8.4 12h7.2'] },
  more: { solid: true, paths: [circle(5.2, 12, 1.6), circle(12, 12, 1.6), circle(18.8, 12, 1.6)] },
  chevronLeft: { paths: ['m14.4 6.2-5.8 5.8 5.8 5.8'] },
  chevronRight: { paths: ['m9.6 6.2 5.8 5.8-5.8 5.8'] },
  chevronDown: { paths: ['m6.2 9.6 5.8 5.8 5.8-5.8'] },
  chevronUp: { paths: ['m6.2 14.4 5.8-5.8 5.8 5.8'] },
  sun: {
    paths: [
      circle(12, 12, 4),
      'M12 2.8v2.1',
      'M12 19.1v2.1',
      'M4.5 4.5 6 6',
      'M18 18l1.5 1.5',
      'M2.8 12h2.1',
      'M19.1 12h2.1',
      'M4.5 19.5 6 18',
      'M18 6l1.5-1.5',
    ],
  },
  moon: { paths: ['M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z'] },
  search: { paths: [circle(11, 11, 6.4), 'm15.8 15.8 4.4 4.4'] },
  check: { paths: ['m5 12.8 4.6 4.6L19 6.6'] },
  x: { paths: ['m6.4 6.4 11.2 11.2', 'M17.6 6.4 6.4 17.6'] },
  alert: { paths: ['M12 4.4 21 19.6H3z', 'M12 10.2v4', 'M12 16.8h.01'] },
  info: { paths: [circle(12, 12, 8.4), 'M12 11.2v5', 'M12 8h.01'] },
  logOut: {
    paths: [
      'M15 8.4V6.2a2 2 0 0 0-2-2H6.2a2 2 0 0 0-2 2v11.6a2 2 0 0 0 2 2H13a2 2 0 0 0 2-2v-2.2',
      'M10.4 12h9.8',
      'm17.4 8.6 3.4 3.4-3.4 3.4',
    ],
  },
  inbox: {
    paths: [
      'M3.8 13.2h4.4l1.4 2.8h4.8l1.4-2.8h4.4',
      'M6.6 5.2h10.8l3 8v5a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6v-5z',
    ],
  },
  shield: { paths: ['M12 3.2 5 6.1v5.7c0 4.2 2.9 8 7 9.1 4.1-1.1 7-4.9 7-9.1V6.1z'] },
  printer: {
    paths: [
      'M7 9.4V3.8h10v5.6',
      'M7 18.2H5.4A1.6 1.6 0 0 1 3.8 16.6v-4.9a1.6 1.6 0 0 1 1.6-1.6h13.2a1.6 1.6 0 0 1 1.6 1.6v4.9a1.6 1.6 0 0 1-1.6 1.6H17',
      'M7 14.2h10v6H7z',
    ],
  },
  download: { paths: ['M12 3.8v10.4', 'm7.4 10.4 4.6 4.6 4.6-4.6', 'M4.4 19.6h15.2'] },
  trending: { paths: ['m3.4 16.4 5.6-5.6 3.4 3.4 8.2-8.2', 'M15.4 6h5.2v5.2'] },
  chart: { paths: [circle(12, 12, 8.4), 'M12 3.6V12h8.4'] },
  user: { paths: [circle(12, 8.2, 3.8), 'M4.8 20.2a7.2 7.2 0 0 1 14.4 0'] },
  wallet: {
    paths: [
      'M3.8 8.2a2 2 0 0 1 2-2h11.4a2 2 0 0 1 2 2',
      'M3.8 8.2v9.6a2 2 0 0 0 2 2h13.4a1.6 1.6 0 0 0 1.6-1.6v-6a1.6 1.6 0 0 0-1.6-1.6H3.8',
    ],
  },
  clock: { paths: [circle(12, 12, 8.4), 'M12 7.4V12l3 1.8'] },
  spark: {
    paths: [
      'M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8l-1.7-5.4L4.9 10.7 10.3 9z',
      'M18.6 16.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
    ],
  },
  eye: {
    paths: ['M1.8 12S5.7 5.2 12 5.2 22.2 12 22.2 12 18.3 18.8 12 18.8 1.8 12 1.8 12z', circle(12, 12, 2.8)],
  },
  eyeOff: {
    paths: [
      'M9.9 5.4A9.6 9.6 0 0 1 12 5.2c6.3 0 10.2 6.8 10.2 6.8a18.6 18.6 0 0 1-2.7 3.6',
      'M6.4 6.7A18.4 18.4 0 0 0 1.8 12S5.7 18.8 12 18.8a9.8 9.8 0 0 0 4-.8',
      'M10 10a2.8 2.8 0 0 0 4 4',
      'M3.5 3.5l17 17',
    ],
  },
  rotateCw: {
    paths: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  },
  edit: {
    paths: [
      'M3 18.5h3.55l.95-1L12 12.45V10h-1.5L5 15.95 3 18.5z',
      'M17.7 5.3l2-2 3.3 3.3-2 2L17.7 5.3zM12.5 9.5l5-5h-1.4l-3.6 3.6z',
    ],
  },
  archive: { paths: ['M3 5h18v3H3zM8 9h8v9H8zm4 3l3 4H9l3-4z'] },
  trash: {
    paths: ['M3 6h18v2H3zM8 6V4h8v2m-9 0l2 14h10l2-14M11 11v5h2v-5m3 0l-1-4h-4l-1 4z'],
  },
  phone: {
    paths: [
      'M22 16.92v3a2 2 0 0 1-2.2 1.9A16.8 16.8 0 0 1 2 6.1 2 2 0 0 1 4.1 3.9 16.8 16.8 0 0 1 10 8a6 6 0 0 0 8 8z',
    ],
  },
  mail: {
    paths: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M4 8l8 5 8-6'],
  },
  lock: {
    paths: ['M12 20.5v-5', 'M10 15.5H7a5 5 0 0 1 10 0h-3', 'M12 17h.01'],
  },
  mapPin: {
    paths: [
      'M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    ],
  },
}

/**
 * @param {{ name: keyof typeof ICON_PATHS | string, size?: number, strokeWidth?: number, className?: string }} props
 */
export default function Icon({ name, size = 20, strokeWidth = 1.7, className }) {
  const icon = ICON_PATHS[name]
  if (!icon) return null

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={icon.solid ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} fill={icon.solid ? 'currentColor' : 'none'} />
      ))}
    </svg>
  )
}
