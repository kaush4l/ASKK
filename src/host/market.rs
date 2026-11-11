//! # Market: domain tools for market engines (server only)
//!
//! Kept apart from core and the generic tools: it is one domain, and the first candidate to
//! become a connector (a tool that lives outside the app).
use crate::core::{Fut, Tool, Toolbox};
use serde_json::{json, Value};

/// Tool: last price of a symbol (Yahoo chart endpoint, no key).
pub struct Quote;

impl Tool for Quote {
    fn name(&self) -> String {
        "quote".into()
    }
    fn description(&self) -> String {
        "latest market price of a ticker".into()
    }
    fn args(&self) -> Value {
        json!({"symbol": "e.g. AAPL"})
    }
    fn invoke(&self, args: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        Box::pin(async move {
            let sym = args["symbol"].as_str().ok_or("symbol missing")?.to_uppercase();
            let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d");
            let v: Value = reqwest::Client::new()
                .get(&url)
                .header("user-agent", "askk/0.1")
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            v["chart"]["result"][0]["meta"]["regularMarketPrice"].as_f64().map(|p| json!(p)).ok_or_else(|| format!("no price for {sym}"))
        })
    }
}
