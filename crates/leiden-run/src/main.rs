use std::env;
use std::fs;
use std::path::Path;

use leiden_rs::{GraphDataBuilder, Leiden, LeidenConfig};
use serde::Serialize;

#[derive(Serialize)]
struct Assignment {
    quality: f64,
    membership: Vec<Member>,
}

#[derive(Serialize)]
struct Member {
    dense_id: u32,
    community: u32,
}

fn read_u32(buf: &[u8], i: &mut usize) -> u32 {
    let v = u32::from_le_bytes(buf[*i..*i + 4].try_into().unwrap());
    *i += 4;
    v
}

fn read_u64(buf: &[u8], i: &mut usize) -> u64 {
    let v = u64::from_le_bytes(buf[*i..*i + 8].try_into().unwrap());
    *i += 8;
    v
}

fn read_f32(buf: &[u8], i: &mut usize) -> f32 {
    let v = f32::from_le_bytes(buf[*i..*i + 4].try_into().unwrap());
    *i += 4;
    v
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|a| a == "--help") {
        println!("leiden-run --csr graph.csr --out assignment.json");
        return;
    }
    let csr_path = arg_value(&args, "--csr").expect("--csr required");
    let out_path = arg_value(&args, "--out").expect("--out required");
    let bytes = fs::read(Path::new(&csr_path)).expect("read csr");
    let mut pos = 0usize;
    let magic = read_u32(&bytes, &mut pos);
    assert_eq!(magic, u32::from_le_bytes(*b"CSR1"), "bad magic");
    let n_nodes = read_u32(&bytes, &mut pos) as usize;
    let n_edges = read_u32(&bytes, &mut pos) as usize;
    let mut offsets = Vec::with_capacity(n_nodes + 1);
    for _ in 0..=n_nodes {
        offsets.push(read_u64(&bytes, &mut pos) as usize);
    }
    let mut neighbors = Vec::with_capacity(n_edges);
    for _ in 0..n_edges {
        neighbors.push(read_u32(&bytes, &mut pos));
    }
    let mut weights = Vec::with_capacity(n_edges);
    for _ in 0..n_edges {
        weights.push(read_f32(&bytes, &mut pos));
    }
    let mut builder = GraphDataBuilder::new(n_nodes);
    for u in 0..n_nodes {
        let start = offsets[u];
        let end = offsets[u + 1];
        for e in start..end {
            let v = neighbors[e] as usize;
            if u < v {
                builder.add_edge(u, v, f64::from(weights[e])).expect("edge");
            }
        }
    }
    let graph = builder.build().expect("graph");
    let result = Leiden::new(LeidenConfig::default()).run(&graph).expect("leiden");
    let mut membership = Vec::with_capacity(n_nodes);
    for dense_id in 0..n_nodes {
        membership.push(Member {
            dense_id: dense_id as u32,
            community: result.partition.community_of(dense_id) as u32,
        });
    }
    let assignment = Assignment {
        quality: result.quality,
        membership,
    };
    fs::write(out_path, serde_json::to_string_pretty(&assignment).unwrap()).unwrap();
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == flag).map(|w| w[1].clone())
}
