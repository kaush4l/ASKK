//! (a) Golden-file test (§8.7): the rendered paper for the representative
//! state is snapshotted and compared byte-for-byte. A prompt regression is a
//! `git diff`, not archaeology. Regenerate with UPDATE_GOLDEN=1.

use paper_spike::{assemble, render, Budget, Phase, ProviderFormat, State};

#[test]
fn golden_openai_chat_byte_for_byte() {
    let doc = assemble(&State::example(), Phase::Act, Budget::unlimited());
    let got = serde_json::to_string_pretty(&render(&doc, ProviderFormat::OpenAiChat)).unwrap();
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/openai_chat.json");
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(path, &got).unwrap();
        return;
    }
    let want = std::fs::read_to_string(path)
        .expect("golden snapshot missing; run once with UPDATE_GOLDEN=1");
    assert_eq!(
        got, want,
        "rendered paper diverged from the committed golden snapshot"
    );
}
