// Starter files for a freshly-created deck.
//
// Per architecture doc §7 ("Deck structure on disk"):
//   deck-{slug}/
//     deck.json         -- manifest: title, slide order, brand kit, theme
//     slides/s1.html    -- one file per slide, id-matched to manifest
//     styles/global.css -- deck-wide styles
//     scripts/global.js -- deck-wide JS
//     assets/           -- per-deck images, video, fonts
//
// Phase 1 omits brand_kit and theme_overrides — those land in Phase 2.

export interface StarterDeckInput {
  title: string;
}

export interface StarterFiles {
  /** Map of relative-path -> file contents to write before the initial commit. */
  files: Record<string, string>;
}

const FIRST_SLIDE_ID = 's1';

export function buildStarterFiles(input: StarterDeckInput): StarterFiles {
  const manifest = {
    title: input.title,
    slides: [
      {
        id: FIRST_SLIDE_ID,
        title: 'Untitled slide',
        notes: '',
      },
    ],
  };

  return {
    files: {
      'deck.json': JSON.stringify(manifest, null, 2) + '\n',
      'slides/s1.html':
        '<section class="slide" data-slide-id="s1">\n  <!-- Empty starter slide. -->\n</section>\n',
      'styles/global.css': '/* Deck-wide styles. */\n',
      'scripts/global.js': '// Deck-wide JS.\n',
      // .gitkeep so the empty assets dir survives the initial commit.
      'assets/.gitkeep': '',
      '.gitignore': '# Per-deck git ignores.\n.DS_Store\n',
    },
  };
}
