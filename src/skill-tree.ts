import * as vscode from 'vscode';
import { Skill, SkillRegistry } from './skills';

const SOURCE_ICONS: Record<string, vscode.ThemeIcon> = {
	workspace: new vscode.ThemeIcon('folder'),
	global: new vscode.ThemeIcon('home'),
	github: new vscode.ThemeIcon('github'),
};

export class SkillTreeProvider implements vscode.TreeDataProvider<Skill> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private registry: SkillRegistry) {
		registry.onDidChange(() => this._onDidChangeTreeData.fire());
	}

	getTreeItem(skill: Skill): vscode.TreeItem {
		const item = new vscode.TreeItem(skill.name, vscode.TreeItemCollapsibleState.None);
		item.description = skill.source;
		item.tooltip = skill.description || skill.systemPrompt.slice(0, 120);
		item.iconPath = skill.enabled
			? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
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
			const order = { workspace: 0, global: 1, github: 2 };
			return (order[a.source] - order[b.source]) || a.name.localeCompare(b.name);
		});
	}
}
