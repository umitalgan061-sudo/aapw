#![allow(clippy::too_many_arguments)]

/// Deterministic scalar helpers used by the browser/WASM hot path.
#[inline]
pub fn clamp01(value: f32) -> f32 {
    value.max(0.0).min(1.0)
}

#[inline]
pub fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if edge1 <= edge0 {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    let t = clamp01((value - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

#[inline]
pub fn hash_u32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

#[inline]
pub fn hash_pair(a: i32, b: i32, seed: u32) -> u32 {
    hash_u32((a as u32).wrapping_add(hash_u32((b as u32) ^ seed)))
}

#[inline]
pub fn hash_f32(value: f32, seed: u32) -> u32 {
    hash_u32(value.to_bits() ^ seed)
}

#[inline]
pub fn distance_sq(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 {
    let dx = ax - bx;
    let dy = ay - by;
    let dz = az - bz;
    dx * dx + dy * dy + dz * dz
}

#[inline]
pub fn inverse_sqrt(value: f32) -> f32 {
    if value <= 0.0 { 0.0 } else { 1.0 / value.sqrt() }
}

#[inline]
pub fn normalize3(x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let length_sq = x * x + y * y + z * z;
    if length_sq <= 1.0e-12 {
        return (0.0, 0.0, 0.0);
    }
    let inverse = inverse_sqrt(length_sq);
    (x * inverse, y * inverse, z * inverse)
}

#[inline]
pub fn lerp(a: f32, b: f32, alpha: f32) -> f32 {
    a + (b - a) * alpha
}

#[inline]
pub fn wrap_angle(mut radians: f32) -> f32 {
    const PI: f32 = core::f32::consts::PI;
    const TAU: f32 = PI * 2.0;
    while radians > PI { radians -= TAU; }
    while radians < -PI { radians += TAU; }
    radians
}

#[inline]
pub fn approach(current: f32, target: f32, max_delta: f32) -> f32 {
    let delta = target - current;
    if delta.abs() <= max_delta.abs() { target } else { current + delta.signum() * max_delta.abs() }
}

#[inline]
pub fn critically_damped(current: f32, velocity: f32, target: f32, half_life: f32, dt: f32) -> (f32, f32) {
    if dt <= 0.0 { return (current, velocity); }
    let safe_half_life = half_life.max(0.001);
    let decay = 2.0_f32.powf(-dt / safe_half_life);
    let offset = current - target;
    let next_offset = (offset + (velocity + offset / safe_half_life) * dt) * decay;
    let next_velocity = (velocity - (offset / (safe_half_life * safe_half_life) + velocity / safe_half_life) * dt) * decay;
    (target + next_offset, next_velocity)
}

#[inline]
pub fn spherical_falloff(distance: f32, radius: f32, softness: f32) -> f32 {
    if radius <= 0.0 { return 0.0; }
    let start = radius * (1.0 - clamp01(softness));
    1.0 - smoothstep(start, radius, distance.max(0.0))
}

#[inline]
pub fn capsule_distance_sq(px: f32, py: f32, pz: f32, ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 {
    let abx = bx - ax;
    let aby = by - ay;
    let abz = bz - az;
    let apx = px - ax;
    let apy = py - ay;
    let apz = pz - az;
    let denom = abx * abx + aby * aby + abz * abz;
    let t = if denom > 1.0e-12 { clamp01((apx * abx + apy * aby + apz * abz) / denom) } else { 0.0 };
    let qx = ax + abx * t;
    let qy = ay + aby * t;
    let qz = az + abz * t;
    distance_sq(px, py, pz, qx, qy, qz)
}

#[inline]
pub fn sphere_overlap(ax: f32, ay: f32, az: f32, ar: f32, bx: f32, by: f32, bz: f32, br: f32) -> u32 {
    let radius = ar.max(0.0) + br.max(0.0);
    if distance_sq(ax, ay, az, bx, by, bz) <= radius * radius { 1 } else { 0 }
}

#[inline]
pub fn aabb_distance_sq(px: f32, py: f32, pz: f32, min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) -> f32 {
    let qx = px.max(min_x).min(max_x);
    let qy = py.max(min_y).min(max_y);
    let qz = pz.max(min_z).min(max_z);
    distance_sq(px, py, pz, qx, qy, qz)
}

#[inline]
pub fn deterministic_jitter(index: u32, seed: u32, amplitude: f32) -> (f32, f32, f32) {
    let hx = hash_u32(index ^ seed);
    let hy = hash_u32(hx.wrapping_add(0x9e37_79b9));
    let hz = hash_u32(hy.wrapping_add(0x85eb_ca6b));
    let to_unit = |value: u32| value as f32 / 4_294_967_295.0 * 2.0 - 1.0;
    (to_unit(hx) * amplitude, to_unit(hy) * amplitude, to_unit(hz) * amplitude)
}

#[inline]
pub fn boids_acceleration(
    px: f32, py: f32, pz: f32,
    vx: f32, vy: f32, vz: f32,
    cx: f32, cy: f32, cz: f32,
    avx: f32, avy: f32, avz: f32,
    separation_radius: f32,
    alignment_weight: f32,
    cohesion_weight: f32,
    separation_weight: f32,
    max_acceleration: f32,
) -> (f32, f32, f32) {
    let to_center = (cx - px, cy - py, cz - pz);
    let inv_distance = inverse_sqrt(to_center.0 * to_center.0 + to_center.1 * to_center.1 + to_center.2 * to_center.2);
    let cohesion = (to_center.0 * inv_distance * cohesion_weight, to_center.1 * inv_distance * cohesion_weight, to_center.2 * inv_distance * cohesion_weight);
    let alignment = ((avx - vx) * alignment_weight, (avy - vy) * alignment_weight, (avz - vz) * alignment_weight);
    let separation_distance_sq = separation_radius.max(0.001).powi(2);
    let separation = if to_center.0 * to_center.0 + to_center.1 * to_center.1 + to_center.2 * to_center.2 < separation_distance_sq {
        (-to_center.0 * separation_weight, -to_center.1 * separation_weight, -to_center.2 * separation_weight)
    } else { (0.0, 0.0, 0.0) };
    let ax = cohesion.0 + alignment.0 + separation.0;
    let ay = cohesion.1 + alignment.1 + separation.1;
    let az = cohesion.2 + alignment.2 + separation.2;
    let length = (ax * ax + ay * ay + az * az).sqrt();
    if max_acceleration <= 0.0 || length <= max_acceleration { (ax, ay, az) } else {
        let scale = max_acceleration / length;
        (ax * scale, ay * scale, az * scale)
    }
}

#[inline]
pub fn steering_to_target(
    px: f32, py: f32, pz: f32,
    vx: f32, vy: f32, vz: f32,
    tx: f32, ty: f32, tz: f32,
    max_speed: f32,
    max_acceleration: f32,
) -> (f32, f32, f32) {
    let (dx, dy, dz) = normalize3(tx - px, ty - py, tz - pz);
    let desired_x = dx * max_speed.max(0.0);
    let desired_y = dy * max_speed.max(0.0);
    let desired_z = dz * max_speed.max(0.0);
    let ax = desired_x - vx;
    let ay = desired_y - vy;
    let az = desired_z - vz;
    let length = (ax * ax + ay * ay + az * az).sqrt();
    if max_acceleration <= 0.0 || length <= max_acceleration { (ax, ay, az) } else {
        let scale = max_acceleration / length;
        (ax * scale, ay * scale, az * scale)
    }
}

#[inline]
pub fn integrate_velocity(
    px: f32, py: f32, pz: f32,
    vx: f32, vy: f32, vz: f32,
    ax: f32, ay: f32, az: f32,
    dt: f32,
    drag: f32,
    max_speed: f32,
) -> (f32, f32, f32, f32, f32, f32) {
    let safe_dt = dt.max(0.0).min(0.25);
    let damping = (-drag.max(0.0) * safe_dt).exp();
    let next_vx = (vx + ax * safe_dt) * damping;
    let next_vy = (vy + ay * safe_dt) * damping;
    let next_vz = (vz + az * safe_dt) * damping;
    let speed_sq = next_vx * next_vx + next_vy * next_vy + next_vz * next_vz;
    let (final_vx, final_vy, final_vz) = if max_speed > 0.0 && speed_sq > max_speed * max_speed {
        let scale = max_speed / speed_sq.sqrt();
        (next_vx * scale, next_vy * scale, next_vz * scale)
    } else { (next_vx, next_vy, next_vz) };
    (px + final_vx * safe_dt, py + final_vy * safe_dt, pz + final_vz * safe_dt, final_vx, final_vy, final_vz)
}

#[inline]
pub fn stable_lod(distance: f32, near: f32, far: f32, bias: f32) -> f32 {
    if far <= near { return if distance <= near { 1.0 } else { 0.0 }; }
    let normalized = clamp01((distance.max(0.0) - near) / (far - near));
    let shaped = normalized.powf((1.0 + bias.max(-0.9)).max(0.1));
    1.0 - smoothstep(0.0, 1.0, shaped)
}

#[inline]
pub fn visibility_score(distance: f32, radius: f32, importance: f32, lod: f32) -> f32 {
    let near_surface = (radius.max(0.0) / (distance.max(0.001))).min(1.0);
    clamp01(near_surface * 0.6 + importance.clamp(0.0, 1.0) * 0.3 + lod.clamp(0.0, 1.0) * 0.1)
}

#[inline]
pub fn temporal_weight(current: f32, previous: f32, confidence: f32, motion: f32, dt: f32) -> f32 {
    let difference = (current - previous).abs();
    let stability = 1.0 - clamp01(difference * 4.0 + motion.max(0.0) * 0.5);
    clamp01(confidence) * stability * clamp01(dt * 60.0)
}

#[inline]
pub fn quantize_signed(value: f32, step: f32) -> i32 {
    if step <= 0.0 { 0 } else { (value / step).round() as i32 }
}

#[inline]
pub fn oct_encode(x: f32, y: f32, z: f32) -> (i16, i16) {
    let (mut nx, mut ny, mut nz) = normalize3(x, y, z);
    let l1 = nx.abs() + ny.abs() + nz.abs();
    if l1 <= 1.0e-6 { return (0, 0); }
    nx /= l1; ny /= l1; nz /= l1;
    if nz < 0.0 {
        let old_x = nx;
        nx = (1.0 - ny.abs()) * old_x.signum();
        ny = (1.0 - old_x.abs()) * ny.signum();
    }
    ((clamp01(nx * 0.5 + 0.5) * 65534.0 - 32767.0) as i16, (clamp01(ny * 0.5 + 0.5) * 65534.0 - 32767.0) as i16)
}

#[inline]
pub fn bucket_index(value: f32, minimum: f32, maximum: f32, buckets: u32) -> u32 {
    if buckets == 0 || maximum <= minimum { return 0; }
    let t = clamp01((value - minimum) / (maximum - minimum));
    ((t * buckets as f32) as u32).min(buckets - 1)
}

#[inline]
pub fn deterministic_phase(index: u32, tick: u32, seed: u32) -> f32 {
    let mixed = hash_u32(index.wrapping_mul(0x9e37_79b9) ^ tick.rotate_left(13) ^ seed);
    mixed as f32 / 4_294_967_295.0
}

#[inline]
pub fn terrain_weight(height: f32, slope: f32, moisture: f32, temperature: f32) -> u32 {
    let elevation = smoothstep(250.0, 700.0, height);
    let steepness = 1.0 - smoothstep(0.15, 0.85, slope.abs());
    let wet = moisture.clamp(0.0, 1.0);
    let thermal = temperature.clamp(0.0, 1.0);
    let score = clamp01(elevation * 0.25 + steepness * 0.3 + wet * 0.25 + thermal * 0.2);
    (score * 65535.0).round() as u32
}

#[inline]
pub fn deterministic_spawn(index: u32, seed: u32, min_x: f32, max_x: f32, min_z: f32, max_z: f32) -> (f32, f32) {
    let hx = hash_u32(index ^ seed);
    let hz = hash_u32(hx.wrapping_add(0x9e37_79b9));
    let ux = hx as f32 / 4_294_967_295.0;
    let uz = hz as f32 / 4_294_967_295.0;
    (lerp(min_x, max_x, ux), lerp(min_z, max_z, uz))
}

#[inline]
pub fn fixed_step_count(accumulator: f32, step: f32, max_steps: u32) -> (u32, f32) {
    if step <= 0.0 || max_steps == 0 { return (0, accumulator.max(0.0)); }
    let safe = accumulator.max(0.0).min(step * max_steps as f32);
    let steps = (safe / step).floor() as u32;
    (steps.min(max_steps), (safe - steps as f32 * step).max(0.0))
}

#[inline]
pub fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

#[inline]
pub fn finite_vec3(x: f32, y: f32, z: f32, fallback: f32) -> (f32, f32, f32) {
    (finite_or(x, fallback), finite_or(y, fallback), finite_or(z, fallback))
}

#[inline]
pub fn saturating_add_u32(a: u32, b: u32) -> u32 {
    a.saturating_add(b)
}

#[inline]
pub fn saturating_mul_u32(a: u32, b: u32) -> u32 {
    a.saturating_mul(b)
}

#[inline]
pub fn hash_sequence(values: &[u32]) -> u32 {
    let mut hash = 0x811c_9dc5_u32;
    for value in values {
        let mut local = *value;
        for _ in 0..4 {
            hash ^= local & 0xff;
            hash = hash.wrapping_mul(0x0100_0193);
            local >>= 8;
        }
    }
    hash
}

#[inline]
pub fn compare_epsilon(a: f32, b: f32, epsilon: f32) -> u32 {
    if (a - b).abs() <= epsilon.abs().max(1.0e-7) { 1 } else { 0 }
}
