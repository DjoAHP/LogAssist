#!/usr/bin/env node
/**
 * Génère toutes les icônes Tauri à partir de logo3.png (1024x1024).
 * Utilise sharp pour redimensionner et exporter tous les formats requis.
 */
import sharp from "sharp"
import fs from "fs"
import path from "path"
import toIco from "to-ico"

const ICONS_DIR = path.resolve("src-tauri/icons")
const SOURCE = path.join(ICONS_DIR, "logo3.png")

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function main() {
  const img = sharp(SOURCE)
  const metadata = await img.metadata()
  console.log(`Source: ${metadata.width}x${metadata.height}`)

  // 1. Icônes desktop standards (PNG)
  const pngSizes = [
    { name: "32x32.png", size: 32 },
    { name: "64x64.png", size: 64 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "icon.png", size: 512 },
  ]
  for (const { name, size } of pngSizes) {
    await img.resize(size, size).png().toFile(path.join(ICONS_DIR, name))
    console.log(`  ✓ ${name} (${size}x${size})`)
  }

  // 2. Windows ICO (multi-resolution) — via to-ico (format 3.00 compatible RC.exe)
  const icoBuf = await toIco([
    await img.resize(16, 16).png().toBuffer(),
    await img.resize(32, 32).png().toBuffer(),
    await img.resize(48, 48).png().toBuffer(),
    await img.resize(256, 256).png().toBuffer(),
  ])
  await fs.promises.writeFile(path.join(ICONS_DIR, "icon.ico"), icoBuf)
  console.log(`  ✓ icon.ico (16,32,48,256) — format 3.00`)

  // 3. Windows Store logos
  const storeSizes = [
    { name: "Square30x30Logo.png", size: 30 },
    { name: "Square44x44Logo.png", size: 44 },
    { name: "Square71x71Logo.png", size: 71 },
    { name: "Square89x89Logo.png", size: 89 },
    { name: "Square107x107Logo.png", size: 107 },
    { name: "Square142x142Logo.png", size: 142 },
    { name: "Square150x150Logo.png", size: 150 },
    { name: "Square284x284Logo.png", size: 284 },
    { name: "Square310x310Logo.png", size: 310 },
    { name: "StoreLogo.png", size: 50 },
  ]
  for (const { name, size } of storeSizes) {
    await img.resize(size, size).png().toFile(path.join(ICONS_DIR, name))
    console.log(`  ✓ ${name} (${size}x${size})`)
  }

  // 4. macOS ICNS (via iconutil nécessite un .iconset)
  const iconsetDir = path.join(ICONS_DIR, "icon.iconset")
  await ensureDir(iconsetDir)
  const icnsSizes = [
    { name: "icon_16x16.png", size: 16 },
    { name: "icon_16x16@2x.png", size: 32 },
    { name: "icon_32x32.png", size: 32 },
    { name: "icon_32x32@2x.png", size: 64 },
    { name: "icon_128x128.png", size: 128 },
    { name: "icon_128x128@2x.png", size: 256 },
    { name: "icon_256x256.png", size: 256 },
    { name: "icon_256x256@2x.png", size: 512 },
    { name: "icon_512x512.png", size: 512 },
    { name: "icon_512x512@2x.png", size: 1024 },
  ]
  for (const { name, size } of icnsSizes) {
    await img.resize(size, size).png().toFile(path.join(iconsetDir, name))
  }
  // Générer le .icns via iconutil (macOS seulement) — on saute ici, on laisse le .iconset
  // L'utilisateur macOS pourra faire: iconutil -c icns icon.iconset
  console.log(`  ✓ icon.iconset/ (prêt pour iconutil -c icns)`)

  // 5. Android mipmap
  const androidBase = path.join(ICONS_DIR, "android")
  const androidDensities = [
    { dir: "mipmap-mdpi", size: 48 },
    { dir: "mipmap-hdpi", size: 72 },
    { dir: "mipmap-xhdpi", size: 96 },
    { dir: "mipmap-xxhdpi", size: 144 },
    { dir: "mipmap-xxxhdpi", size: 192 },
  ]
  for (const { dir, size } of androidDensities) {
    await ensureDir(path.join(androidBase, dir))
    await img.resize(size, size).png().toFile(path.join(androidBase, dir, "ic_launcher.png"))
    await img.resize(size, size).png().toFile(path.join(androidBase, dir, "ic_launcher_round.png"))
    console.log(`  ✓ android/${dir}/ic_launcher*.png (${size}x${size})`)
  }
  // anydpi-v26 : icône adaptative (vector XML) — on crée un fichier XML minimal
  const anydpiDir = path.join(androidBase, "mipmap-anydpi-v26")
  await ensureDir(anydpiDir)
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`
  fs.writeFileSync(path.join(anydpiDir, "ic_launcher.xml"), adaptiveXml)
  fs.writeFileSync(path.join(anydpiDir, "ic_launcher_round.xml"), adaptiveXml)
  console.log(`  ✓ android/mipmap-anydpi-v26/ic_launcher*.xml`)

  // 6. iOS App Icons
  const iosBase = path.join(ICONS_DIR, "ios")
  const iosSizes = [
    { name: "AppIcon-20x20@1x.png", size: 20 },
    { name: "AppIcon-20x20@2x.png", size: 40 },
    { name: "AppIcon-20x20@3x.png", size: 60 },
    { name: "AppIcon-29x29@1x.png", size: 29 },
    { name: "AppIcon-29x29@2x.png", size: 58 },
    { name: "AppIcon-29x29@3x.png", size: 87 },
    { name: "AppIcon-40x40@1x.png", size: 40 },
    { name: "AppIcon-40x40@2x.png", size: 80 },
    { name: "AppIcon-40x40@3x.png", size: 120 },
    { name: "AppIcon-60x60@2x.png", size: 120 },
    { name: "AppIcon-60x60@3x.png", size: 180 },
    { name: "AppIcon-76x76@1x.png", size: 76 },
    { name: "AppIcon-76x76@2x.png", size: 152 },
    { name: "AppIcon-83.5x83.5@2x.png", size: 167 },
    { name: "AppIcon-512@2x.png", size: 1024 }, // App Store
  ]
  for (const { name, size } of iosSizes) {
    await img.resize(size, size).png().toFile(path.join(iosBase, name))
    console.log(`  ✓ ios/${name} (${size}x${size})`)
  }

  console.log("\n✅ Toutes les icônes générées avec succès !")
  console.log("Note: Pour macOS .icns, exécutez sur Mac: iconutil -c icns src-tauri/icons/icon.iconset")
}

main().catch((e) => {
  console.error("❌ Erreur:", e)
  process.exit(1)
})