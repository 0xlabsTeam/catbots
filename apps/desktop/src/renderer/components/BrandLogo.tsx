/** The same artwork as the packaged app icon. Do not redraw or recolor it. */
const logoUrl = new URL('../../../assets/icon.png', import.meta.url).href;

type BrandLogoProps = { size?: 'small' | 'large'; decorative?: boolean };

export function BrandLogo({ size = 'small', decorative = false }: BrandLogoProps) {
  return <img className={`brand-logo brand-logo-${size}`} src={logoUrl} alt={decorative ? '' : 'Catbots'} draggable={false} />;
}
