import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentSettingsError,
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
} from './agent-settings.js';

describe('parseSettings', () => {
  it('returns defaults on empty YAML', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults on null YAML (just comments)', () => {
    expect(parseSettings('# comment only\n')).toEqual(DEFAULT_SETTINGS);
  });

  it('parses the MVP-relevant fields', () => {
    const yamlText = `
llm:
  default_provider: anthropic
  default_mode: cli
roles:
  active_role: developer
commands:
  suggestion:
    enabled: false
    senior_gate: true
`;
    expect(parseSettings(yamlText)).toEqual({
      llm: { default_provider: 'anthropic', default_mode: 'cli', providers: [] },
      roles: { active_role: 'developer' },
      commands: { suggestion: { enabled: false, senior_gate: true } },
      mcp: { servers: [] },
    });
  });

  it('parses OpenAI-compatible provider endpoints (T-506)', () => {
    const yamlText = `
llm:
  default_provider: openai-compat
  providers:
    - id: groq
      base_url: https://api.groq.com/openai/v1
      api_key_env: GROQ_API_KEY
      default_model: llama-3.3-70b
    - id: together
      base_url: https://api.together.xyz/v1
`;
    const result = parseSettings(yamlText);
    expect(result.llm.default_provider).toBe('openai-compat');
    expect(result.llm.providers).toHaveLength(2);
    expect(result.llm.providers[0]).toMatchObject({
      id: 'groq',
      base_url: 'https://api.groq.com/openai/v1',
      api_key_env: 'GROQ_API_KEY',
      default_model: 'llama-3.3-70b',
    });
  });

  it('ignores unknown top-level keys (forward-compat)', () => {
    const yamlText = `
llm:
  default_mode: api
quality:
  local_auto_run: false
future_feature:
  enabled: true
`;
    const result = parseSettings(yamlText);
    expect(result.llm.default_mode).toBe('api');
    // Defaults for non-set MVP fields still fill in.
    expect(result.roles.active_role).toBeUndefined();
    expect(result.commands.suggestion.enabled).toBe(true);
  });

  it('ignores unknown nested keys under MVP sections', () => {
    const yamlText = `
llm:
  default_mode: cli
  future_field: surprise
commands:
  suggestion:
    enabled: false
    unknown_subkey: 42
`;
    const result = parseSettings(yamlText);
    expect(result.llm.default_mode).toBe('cli');
    expect(result.commands.suggestion.enabled).toBe(false);
  });

  it('throws AgentSettingsError on malformed YAML', () => {
    expect(() => parseSettings('llm:\n  default_mode: : :')).toThrow(AgentSettingsError);
  });

  it('throws AgentSettingsError on invalid enum value', () => {
    expect(() => parseSettings('llm:\n  default_mode: telepathy\n')).toThrow(/schema violation/);
  });

  it('throws on top-level array (not a mapping)', () => {
    expect(() => parseSettings('- one\n- two\n')).toThrow(/top-level must be a mapping/);
  });

  it('defaults mcp.servers to an empty array when absent', () => {
    expect(parseSettings('llm:\n  default_mode: cli\n').mcp.servers).toEqual([]);
  });

  it('parses mcp.servers with per-server defaults (T-1101)', () => {
    const result = parseSettings(
      'mcp:\n  servers:\n    - id: github\n      command: npx\n      args: ["-y", "gh-mcp"]\n',
    );
    expect(result.mcp.servers).toHaveLength(1);
    expect(result.mcp.servers[0]).toMatchObject({
      id: 'github',
      command: 'npx',
      args: ['-y', 'gh-mcp'],
      env: {},
      enabled: true,
    });
  });

  it('rejects an mcp server id containing a colon', () => {
    expect(() =>
      parseSettings('mcp:\n  servers:\n    - id: "bad:id"\n      command: npx\n'),
    ).toThrow(AgentSettingsError);
  });
});

describe('loadSettings', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event4u-settings-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns DEFAULT_SETTINGS when file does not exist', async () => {
    const result = await loadSettings(join(tempDir, 'missing.yml'));
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it('reads and parses a real file', async () => {
    const path = join(tempDir, '.agent-settings.yml');
    await writeFile(path, 'llm:\n  default_mode: cli\n', 'utf8');
    const result = await loadSettings(path);
    expect(result.llm.default_mode).toBe('cli');
  });

  it('propagates AgentSettingsError on malformed file', async () => {
    const path = join(tempDir, 'bad.yml');
    await writeFile(path, 'llm:\n  default_mode: : :', 'utf8');
    await expect(loadSettings(path)).rejects.toThrow(AgentSettingsError);
  });
});
