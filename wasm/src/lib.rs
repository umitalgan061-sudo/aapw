#![no_std]

use core::slice;

mod simulation_v2;

const SCRATCH_CAP: usize = 65_536;
static mut SCRATCH: [f32; SCRATCH_CAP] = [0.0; SCRATCH_CAP];

#[inline]
fn clamp01(value: f32) -> f32 { if value < 0.0 { 0.0 } else if value > 1.0 { 1.0 } else { value } }
#[inline]
fn mix(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }
#[inline]
fn hash_u32(mut x: u32) -> u32 { x ^= x >> 16; x = x.wrapping_mul(0x7feb_352d); x ^= x >> 15; x = x.wrapping_mul(0x846c_a68b); x ^ (x >> 16) }
#[inline]
fn hash2(x: i32, z: i32, seed: u32) -> u32 { hash_u32((x as u32) ^ hash_u32((z as u32).wrapping_add(seed))) }
#[inline]
fn value_noise(x: f32, z: f32, seed: u32) -> f32 {
    let x0 = x.floor() as i32; let z0 = z.floor() as i32; let fx = x - x.floor(); let fz = z - z.floor();
    let sx = fx * fx * (3.0 - 2.0 * fx); let sz = fz * fz * (3.0 - 2.0 * fz);
    let n00 = hash2(x0, z0, seed) as f32 / 4_294_967_295.0;
    let n10 = hash2(x0 + 1, z0, seed) as f32 / 4_294_967_295.0;
    let n01 = hash2(x0, z0 + 1, seed) as f32 / 4_294_967_295.0;
    let n11 = hash2(x0 + 1, z0 + 1, seed) as f32 / 4_294_967_295.0;
    mix(mix(n00, n10, sx), mix(n01, n11, sx), sz) * 2.0 - 1.0
}

#[no_mangle]
pub extern "C" fn sample_height(x: f32, z: f32, seed: u32) -> f32 {
    let mut frequency = 0.0016_f32; let mut amplitude = 1.0_f32; let mut total = 0.0_f32; let mut weight = 0.0_f32;
    let mut octave = 0; while octave < 6 { total += value_noise(x * frequency, z * frequency, seed.wrapping_add(octave * 0x9e37)) * amplitude; weight += amplitude; amplitude *= 0.5; frequency *= 2.03; octave += 1; }
    let normalized = if weight > 0.0 { total / weight } else { 0.0 };
    let broad = value_noise(x * 0.00055, z * 0.00055, seed ^ 0xA53C_91D7);
    320.0 + normalized * 125.0 + broad * 55.0
}

#[no_mangle]
pub extern "C" fn lod_factor(distance_m: f32, near_m: f32, far_m: f32) -> f32 {
    if far_m <= near_m { return if distance_m <= near_m { 1.0 } else { 0.0 }; }
    let t = clamp01((distance_m - near_m) / (far_m - near_m)); 1.0 - t * t * (3.0 - 2.0 * t)
}

#[no_mangle]
pub extern "C" fn distance_sq(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 { simulation_v2::distance_sq(ax, ay, az, bx, by, bz) }

#[no_mangle]
pub extern "C" fn spatial_key(cell_x: i32, cell_z: i32) -> u32 { hash2(cell_x, cell_z, 0xB529_7A4D) }

#[no_mangle]
pub extern "C" fn aabb_visible(min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32, cx: f32, cy: f32, cz: f32, radius: f32) -> u32 {
    let px = cx.max(min_x).min(max_x); let py = cy.max(min_y).min(max_y); let pz = cz.max(min_z).min(max_z);
    let dx = cx - px; let dy = cy - py; let dz = cz - pz; if dx * dx + dy * dy + dz * dz <= radius * radius { 1 } else { 0 }
}

#[no_mangle]
pub extern "C" fn bilinear_sample(h00: f32, h10: f32, h01: f32, h11: f32, tx: f32, tz: f32) -> f32 { let x = clamp01(tx); let z = clamp01(tz); mix(mix(h00, h10, x), mix(h01, h11, x), z) }

#[no_mangle]
pub extern "C" fn quantize(value: f32, step: f32) -> i32 { if step <= 0.0 { 0 } else { (value / step).round() as i32 } }

#[no_mangle]
pub extern "C" fn fnv1a_u32(values_ptr: *const u32, len: usize) -> u32 {
    if values_ptr.is_null() || len == 0 { return 0x811c_9dc5; }
    let values = unsafe { slice::from_raw_parts(values_ptr, len.min(SCRATCH_CAP)) };
    simulation_v2::hash_sequence(values)
}

#[no_mangle]
pub extern "C" fn transform_points(input_ptr: *const f32, count: usize, ox: f32, oz: f32, scale: f32) -> *const f32 {
    if input_ptr.is_null() { return core::ptr::null(); }
    let clamped = count.min(SCRATCH_CAP / 2); let input = unsafe { slice::from_raw_parts(input_ptr, clamped * 2) }; let out = unsafe { &mut SCRATCH[..clamped * 2] };
    let mut index = 0; while index < clamped { out[index * 2] = ox + input[index * 2] * scale; out[index * 2 + 1] = oz + input[index * 2 + 1] * scale; index += 1; }
    out.as_ptr()
}

#[no_mangle]
pub extern "C" fn sample_height_batch(input_ptr: *const f32, count: usize, seed: u32) -> *const f32 {
    if input_ptr.is_null() { return core::ptr::null(); }
    let clamped = count.min(SCRATCH_CAP / 2); let input = unsafe { slice::from_raw_parts(input_ptr, clamped * 2) }; let out = unsafe { &mut SCRATCH[..clamped] };
    let mut index = 0; while index < clamped { out[index] = sample_height(input[index * 2], input[index * 2 + 1], seed); index += 1; }
    out.as_ptr()
}

#[no_mangle]
pub extern "C" fn scratch_ptr() -> *const f32 { unsafe { SCRATCH.as_ptr() } }

#[no_mangle]
pub extern "C" fn version() -> u32 { 2 }

#[no_mangle]
pub extern "C" fn simulation_normalize3(x: f32, y: f32, z: f32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let (nx, ny, nz) = simulation_v2::normalize3(x, y, z);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 3); out[0] = nx; out[1] = ny; out[2] = nz; }
    1
}

#[no_mangle]
pub extern "C" fn simulation_steer_to_target(px: f32, py: f32, pz: f32, vx: f32, vy: f32, vz: f32, tx: f32, ty: f32, tz: f32, max_speed: f32, max_acceleration: f32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let (ax, ay, az) = simulation_v2::steering_to_target(px, py, pz, vx, vy, vz, tx, ty, tz, max_speed, max_acceleration);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 3); out[0] = ax; out[1] = ay; out[2] = az; }
    1
}

#[no_mangle]
pub extern "C" fn simulation_integrate_velocity(px: f32, py: f32, pz: f32, vx: f32, vy: f32, vz: f32, ax: f32, ay: f32, az: f32, dt: f32, drag: f32, max_speed: f32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let result = simulation_v2::integrate_velocity(px, py, pz, vx, vy, vz, ax, ay, az, dt, drag, max_speed);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 6); out.copy_from_slice(&[result.0, result.1, result.2, result.3, result.4, result.5]); }
    1
}

#[no_mangle]
pub extern "C" fn simulation_boids(px: f32, py: f32, pz: f32, vx: f32, vy: f32, vz: f32, cx: f32, cy: f32, cz: f32, avx: f32, avy: f32, avz: f32, separation_radius: f32, alignment_weight: f32, cohesion_weight: f32, separation_weight: f32, max_acceleration: f32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let (ax, ay, az) = simulation_v2::boids_acceleration(px, py, pz, vx, vy, vz, cx, cy, cz, avx, avy, avz, separation_radius, alignment_weight, cohesion_weight, separation_weight, max_acceleration);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 3); out[0] = ax; out[1] = ay; out[2] = az; }
    1
}

#[no_mangle]
pub extern "C" fn simulation_culling_distance(px: f32, py: f32, pz: f32, min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) -> f32 { simulation_v2::aabb_distance_sq(px, py, pz, min_x, min_y, min_z, max_x, max_y, max_z) }

#[no_mangle]
pub extern "C" fn simulation_lod(distance: f32, near: f32, far: f32, bias: f32) -> f32 { simulation_v2::stable_lod(distance, near, far, bias) }

#[no_mangle]
pub extern "C" fn simulation_spawn(index: u32, seed: u32, min_x: f32, max_x: f32, min_z: f32, max_z: f32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let (x, z) = simulation_v2::deterministic_spawn(index, seed, min_x, max_x, min_z, max_z);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 2); out[0] = x; out[1] = z; }
    1
}

#[no_mangle]
pub extern "C" fn simulation_fixed_steps(accumulator: f32, step: f32, max_steps: u32, out_ptr: *mut f32) -> u32 {
    if out_ptr.is_null() { return 0; }
    let (steps, remainder) = simulation_v2::fixed_step_count(accumulator, step, max_steps);
    unsafe { let out = slice::from_raw_parts_mut(out_ptr, 2); out[0] = steps as f32; out[1] = remainder; }
    1
}

#[no_mangle]
pub extern "C" fn simulation_hash_sequence(values_ptr: *const u32, len: usize) -> u32 {
    if values_ptr.is_null() || len == 0 { return 0x811c_9dc5; }
    let values = unsafe { slice::from_raw_parts(values_ptr, len.min(SCRATCH_CAP)) };
    simulation_v2::hash_sequence(values)
}
