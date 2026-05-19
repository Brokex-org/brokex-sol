//! Shared LiteSVM program artifacts (see repo `yarn test:rust:litesvm`).
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Load the most recently modified `.so` for `program_name`.
///
/// - `cargo build-sbf` → `target/sbpf-solana-solana/release/*.so`
/// - `anchor build` / `build:mock-oracle:sbf` → `target/deploy/*.so`
pub fn load_program_elf(program_name: &str) -> &'static [u8] {
    let root = repo_root();
    let candidates = [
        root.join(format!(
            "target/sbpf-solana-solana/release/{program_name}.so"
        )),
        root.join(format!("target/deploy/{program_name}.so")),
    ];

    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    for path in candidates.iter().filter(|p| p.is_file()) {
        let Ok(modified) = std::fs::metadata(path).and_then(|m| m.modified()) else {
            continue;
        };
        if best.as_ref().is_none_or(|(_, t)| modified > *t) {
            best = Some((path.clone(), modified));
        }
    }

    let (path, _) = best.unwrap_or_else(|| {
        panic!(
            "no {program_name}.so under target/sbpf-solana-solana/release or target/deploy — \
run `yarn test:rust:litesvm` or `cargo build-sbf --manifest-path programs/{program_name}/Cargo.toml --sbf-out-dir target/deploy`"
        )
    });

    let data = std::fs::read(&path).unwrap_or_else(|e| {
        panic!("cannot read {}: {e}", path.display())
    });
    Box::leak(data.into_boxed_slice())
}
