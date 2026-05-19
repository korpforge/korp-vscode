import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { SkillRegistry } from '../skills';

vi.mock('fs');

const mockContext = {
	globalState: {
		get: () => [],
		update: async () => {},
	},
	secrets: { get: async () => undefined, store: async () => {} },
	subscriptions: [],
	extensionUri: { fsPath: '/mock' },
} as any;

describe('SkillRegistry', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('parses a skill file with frontmatter', async () => {
		const content = `---
name: reviewer
description: Code review skill
tools: [readFile, grep]
---
Tu es un reviewer senior.`;

		vi.spyOn(fs, 'readdirSync').mockReturnValue(['reviewer.md'] as any);
		vi.spyOn(fs, 'readFileSync').mockReturnValue(content);

		const registry = new SkillRegistry(mockContext);
		await registry.load();

		const skills = registry.skills;
		expect(skills.length).toBeGreaterThanOrEqual(1);

		const skill = skills.find(s => s.name === 'reviewer');
		expect(skill).toBeDefined();
		expect(skill!.description).toBe('Code review skill');
		expect(skill!.systemPrompt).toBe('Tu es un reviewer senior.');
		expect(skill!.meta['tools']).toEqual(['readFile', 'grep']);
		expect(skill!.enabled).toBe(true);
	});

	it('parses a skill file without frontmatter', async () => {
		const content = `Just a raw prompt without any YAML header.`;

		vi.spyOn(fs, 'readdirSync').mockReturnValue(['raw.md'] as any);
		vi.spyOn(fs, 'readFileSync').mockReturnValue(content);

		const registry = new SkillRegistry(mockContext);
		await registry.load();

		const skill = registry.skills.find(s => s.id.includes('raw'));
		expect(skill).toBeDefined();
		expect(skill!.name).toBe('raw');
		expect(skill!.systemPrompt).toBe(content);
	});

	it('handles missing directory gracefully', async () => {
		vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
			throw new Error('ENOENT');
		});

		const registry = new SkillRegistry(mockContext);
		await registry.load();
		expect(registry.skills).toEqual([]);
	});

	it('toggles skill enabled state', async () => {
		const content = `---
name: test-skill
---
prompt`;

		vi.spyOn(fs, 'readdirSync').mockReturnValue(['test-skill.md'] as any);
		vi.spyOn(fs, 'readFileSync').mockReturnValue(content);

		const updateSpy = vi.fn();
		const ctx = { ...mockContext, globalState: { get: () => [], update: updateSpy } };

		const registry = new SkillRegistry(ctx as any);
		await registry.load();

		const skill = registry.skills[0];
		expect(skill.enabled).toBe(true);

		await registry.toggleSkill(skill.id);
		expect(registry.getSkill(skill.id)!.enabled).toBe(false);
		expect(updateSpy).toHaveBeenCalled();
	});

	it('returns only enabled skills from enabledSkills', async () => {
		vi.spyOn(fs, 'readdirSync').mockReturnValue(['a.md', 'b.md'] as any);
		vi.spyOn(fs, 'readFileSync').mockImplementation((path: any) => {
			if (path.includes('a.md')) return '---\nname: a\n---\nprompt a';
			return '---\nname: b\n---\nprompt b';
		});

		const ctx = { ...mockContext, globalState: { get: () => [], update: async () => {} } };
		const registry = new SkillRegistry(ctx as any);
		await registry.load();

		expect(registry.enabledSkills.length).toBeGreaterThanOrEqual(2);

		await registry.toggleSkill(registry.skills[0].id);
		expect(registry.enabledSkills.length).toBe(registry.skills.length - 1);
	});
});
