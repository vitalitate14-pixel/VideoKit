// Match reels-preview-v2 drawMediaCover: cover -> user zoom -> rotation
// compensation -> flip/rotate about media center -> canvas-relative translation.
function backgroundTransform(width, height, opts = {}) {
    const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const scale = Math.max(0.001, n(opts.bgScale, 100) / 100);
    const angle = n(opts.bgRotation) * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const base = `max(${width}/iw,${height}/ih)*${scale}`;
    const correction = `max(1,max(${width}/((${base})*(iw*${c}+ih*${s})),${height}/((${base})*(iw*${s}+ih*${c}))))`;
    const dx = width * n(opts.bgX) / 100;
    const dy = height * n(opts.bgY) / 100;
    const filters = [
        'scale=trunc(iw*sar/2)*2:ih:flags=lanczos', 'setsar=1', 'format=rgba',
        `scale=w='max(1,round(iw*(${base})*${correction}))':h='max(1,round(ih*(${base})*${correction}))':flags=lanczos`,
    ];
    if (opts.bgFlipH) filters.push('hflip');
    if (opts.bgFlipV) filters.push('vflip');
    if (angle) filters.push(`rotate=${angle}:ow=ceil(rotw(${angle})):oh=ceil(roth(${angle})):c=black`);
    // Pad before cropping: dragging may expose black canvas, rather than clamp
    // to the source edges. Flips must happen before this translation.
    filters.push(`pad=w='max(iw,${width})+${2 * Math.ceil(Math.abs(dx))}':h='max(ih,${height})+${2 * Math.ceil(Math.abs(dy))}':x='(ow-iw)/2':y='(oh-ih)/2':color=black`);
    filters.push(`crop=${width}:${height}:'(iw-ow)/2-(${dx})':'(ih-oh)/2-(${dy})':exact=1`, 'setsar=1');
    return filters.join(',');
}

module.exports = { backgroundTransform };
