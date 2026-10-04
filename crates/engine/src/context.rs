use crate::workspace::{context_safe, Workspace, MAX_FILE};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[derive(Serialize, Clone)]
pub struct Document {
    pub path: String,
    pub summary: String,
    #[serde(skip)]
    pub vector: Vec<f32>,
}

pub fn vector(text: &str) -> Vec<f32> {
    let mut out = vec![0.0f32; 256];
    for token in text
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| t.len() > 1)
        .take(40_000)
    {
        let mut hash = DefaultHasher::new();
        token.to_lowercase().hash(&mut hash);
        out[hash.finish() as usize % 256] += 1.0;
    }
    let norm = out.iter().map(|v| v * v).sum::<f32>().sqrt().max(1.0);
    for v in &mut out {
        *v /= norm;
    }
    out
}

fn ast_summary(path: &str, text: &str) -> String {
    let language = match path.rsplit('.').next().unwrap_or("") {
        "ts" | "js" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" | "jsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        _ => None,
    };
    let Some(language) = language else {
        return text.lines().take(8).collect::<Vec<_>>().join("\n");
    };
    let mut parser = tree_sitter::Parser::new();
    if parser.set_language(&language).is_err() {
        return String::new();
    }
    let Some(tree) = parser.parse(text, None) else {
        return String::new();
    };
    let mut stack = vec![tree.root_node()];
    let mut symbols = Vec::new();
    while let Some(node) = stack.pop() {
        if symbols.len() >= 100 {
            break;
        }
        if matches!(
            node.kind(),
            "function_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "type_alias_declaration"
                | "function_item"
                | "struct_item"
                | "enum_item"
                | "impl_item"
                | "function_definition"
                | "class_definition"
        ) {
            let head = node
                .utf8_text(text.as_bytes())
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("");
            symbols.push(format!(
                "L{}: {}",
                node.start_position().row + 1,
                head.chars().take(220).collect::<String>()
            ));
        }
        let mut cursor = node.walk();
        stack.extend(node.named_children(&mut cursor));
    }
    symbols.join("\n")
}

pub fn index(workspace: &Workspace) -> Vec<Document> {
    // Bounded on-demand index; watcher invalidates it. No source or vectors leave the machine here.
    let mut budget = 32 * 1024 * 1024u64;
    workspace
        .entries()
        .into_iter()
        .filter_map(|entry| {
            if !context_safe(&entry.path) || entry.size > MAX_FILE || entry.size > budget {
                return None;
            }
            let text = workspace.read(&entry.path).ok()?;
            budget -= entry.size;
            Some(Document {
                summary: ast_summary(&entry.path, &text),
                vector: vector(&format!("{} {text}", entry.path)),
                path: entry.path,
            })
        })
        .collect()
}

pub fn retrieve(documents: &[Document], query: &str, limit: usize) -> Vec<Document> {
    let query = vector(query);
    let mut ranked: Vec<_> = documents
        .iter()
        .map(|d| {
            (
                d.vector.iter().zip(&query).map(|(a, b)| a * b).sum::<f32>(),
                d,
            )
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    ranked
        .into_iter()
        .take(limit.min(12))
        .map(|(_, d)| d.clone())
        .collect()
}
