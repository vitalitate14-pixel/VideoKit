// Conservative native-media plan: only move the bottom contiguous media layers
// below the Canvas foreground, preserving the original compositing order.
const path = require('path');

function planMedia(overlays, width, height, duration) {
    const plans = [];
    const sorted = (overlays || []).map((ov, index) => ({ ov, index }))
        .filter(({ ov }) => !ov.disabled)
        .sort((a, b) => (Number(a.ov.z_index) || 0) - (Number(b.ov.z_index) || 0));
    const n = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    for (const { ov, index } of sorted) {
        const ext = path.extname(ov.content || '').toLowerCase();
        if (!['image', 'video'].includes(ov.type) || !path.isAbsolute(ov.content || '')
            || !['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)
            || ov.media_folder_files?.length || ov.is_img_sequence || ov.bind_scroll_overlay_id
            || ov.anim_dest_enabled || n(ov.rotation, 0) || n(ov.media_inner_rotation, 0)
            || (ov.blend_mode && ov.blend_mode !== 'source-over')
            || ['anim_in_type', 'anim_out_type', 'transition_preset'].some(k => ov[k] && ov[k] !== 'none')
            || (ov.media_window_mode && !['pip', 'bottom_half', 'none'].includes(ov.media_window_mode))) break;
        const start = Math.max(0, n(ov.start, 0));
        const end = Math.min(duration, n(ov.end, duration));
        if (start >= end) continue;
        let x = n(ov.x, 0), y = n(ov.y, 0), w = n(ov.w, 100), h = n(ov.h, 100);
        const scale = Math.max(0.01, n(ov.scale, 1));
        const inner = Math.max(0.01, n(ov.media_inner_scale, 1));
        let clip = ov.clip_rect && Number(ov.clip_rect.w) > 0 && Number(ov.clip_rect.h) > 0
            ? { x: n(ov.clip_rect.x, 0), y: n(ov.clip_rect.y, 0), w: Number(ov.clip_rect.w), h: Number(ov.clip_rect.h) }
            : { x: 0, y: 0, w: width, h: height };
        if (ov.media_window_mode === 'pip') {
            const win = ov.media_window || {};
            x = n(win.x, x); y = n(win.y, y); w = n(win.w, w); h = n(win.h, h);
            x += w * (1 - scale) / 2; y += h * (1 - scale) / 2;
            w *= scale; h *= scale;
            clip = { x, y, w, h };
            x += n(ov.media_inner_x, 0) * scale;
            y += n(ov.media_inner_y, 0) * scale;
        } else if (ov.media_window_mode === 'bottom_half') {
            clip = { x: 0, y: height / 2, w: width, h: height / 2 };
            x = n(ov.media_inner_x, 0); y = height / 2 + n(ov.media_inner_y, 0);
        }
        const mediaScale = inner * (ov.media_window_mode === 'pip' ? 1 : scale);
        if (w <= 0 || h <= 0 || clip.w <= 0 || clip.h <= 0) break;
        plans.push({ index, path: ov.content, image: ov.type === 'image', start, end,
            offset: Math.max(0, n(ov.video_start_offset, 0)), loop: ov.media_loop !== false,
            cx: x + w / 2 - clip.x, cy: y + h / 2 - clip.y,
            w: w * mediaScale, h: h * mediaScale, clip,
            aspect: ov.keep_aspect !== false, cover: !!ov.crop_fill,
            flipX: !!ov.flip_x, flipY: !!ov.flip_y,
            opacity: Math.max(0, Math.min(1, n(ov.opacity, 255) <= 1 ? n(ov.opacity, 255) : n(ov.opacity, 255) / 255)) });
    }
    return plans;
}

function appendMedia(args, plans, firstInput, fps, duration) {
    const filters = [];
    let previous = 'bg';
    plans.forEach((p, i) => {
        if (p.image) args.push('-loop', '1');
        else if (p.loop) args.push('-stream_loop', '-1');
        args.push('-i', p.path);
        const w = Math.max(1, Math.round(p.w)), h = Math.max(1, Math.round(p.h));
        const cw = Math.max(1, Math.round(p.clip.w)), ch = Math.max(1, Math.round(p.clip.h));
        // Keep RGBA through scaling/window clipping so transparent PNGs survive.
        const scale = p.aspect
            ? `scale=${w}:${h}:force_original_aspect_ratio=${p.cover ? 'increase' : 'decrease'}:flags=lanczos`
            : `scale=${w}:${h}:flags=lanczos`;
        const transformations = [p.flipX && 'hflip', p.flipY && 'vflip'].filter(Boolean);
        filters.push(`[${firstInput + i}:v]format=rgba,scale=trunc(iw*sar/2)*2:ih,setsar=1,${scale}${transformations.length ? ',' + transformations.join(',') : ''},colorchannelmixer=aa=${p.opacity},fps=${fps},trim=start=${p.image ? 0 : p.offset},setpts=PTS-STARTPTS+${p.start}/TB[media${i}]`);
        filters.push(`color=c=black@0:s=${cw}x${ch}:r=${fps}:d=${duration},format=rgba[window${i}]`);
        filters.push(`[window${i}][media${i}]overlay=x='${p.cx}-overlay_w/2':y='${p.cy}-overlay_h/2':format=auto:eof_action=repeat[clipped${i}]`);
        const out = `native${i}`;
        filters.push(`[${previous}][clipped${i}]overlay=x=${p.clip.x}:y=${p.clip.y}:format=auto:enable='between(t,${p.start},${p.end})'[${out}]`);
        previous = out;
    });
    return { filters, output: previous };
}

module.exports = { planMedia, appendMedia };
