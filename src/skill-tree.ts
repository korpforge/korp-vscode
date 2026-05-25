import * as vscode from 'vscode';
import { Skill, SkillRegistry } from './skills';

const SOURCE_ICONS: Record<string, vscode.ThemeIcon> = {
	'agents-flat': new vscode.ThemeIcon('folder'),
	'agents-dir': new vscode.ThemeIcon('symbol-method'),
	'github-copilot': new vscode.ThemeIcon('github'),
	'korp-legacy': new vscode.ThemeIcon('warning'),
	'global': new vscode.ThemeIcon('home'),
};

const SOURCE_ORDER: Record<string, number> = {
	'agents-flat': 0,
	'agents-dir': 1,
	'github-copilot': 2,
	'global': 3,
	'korp-legacy': 4,
};

export class SkillTreeProvider implements vscode.TreeDataProvider<Skill> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private registry: SkillRegistry) {
		registry.onDidChange(() => this._onDidChangeTreeData.fire());
	}

	getTreeItem(skill: Skill): vscode.TreeItem {
		const label = skill.mode === 'invoke' ? `⚡ ${skill.name}` : skill.name;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.description = `${skill.source} · ${skill.format}`;
		item.tooltip = `${skill.description || skill.systemPrompt.slice(0, 120)}\n\nMode: ${skill.mode} | Trigger: ${skill.trigger}`;
		item.iconPath = skill.enabled
			? (SOURCE_ICONS[skill.source] || new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')))
			: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
		item.contextValue = skill.enabled ? 'skill-enabled' : 'skill-disabled';
		item.command = {
			command: 'korp.toggleSkill',
			title: 'Toggle Skill',
			arguments: [skill.id],
		};
		return item;
	}

	getChildren(): Skill[] {
		return this.registry.skills.sort((a, b) => {
			const orderA = SOURCE_ORDER[a.source] ?? 99;
			const orderB = SOURCE_ORDER[b.source] ?? 99;
			return (orderA - orderB) || a.name.localeCompare(b.name);
		});
	}
}
