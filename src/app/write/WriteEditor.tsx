'use client';

import {
	useActionState,
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type MouseEvent,
	type RefObject,
} from 'react';
import {
	Bold,
	Code2,
	Heading1,
	Heading2,
	Italic,
	List,
	ListOrdered,
	Quote,
	Send,
	TextQuote,
	Type,
	type LucideIcon,
} from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { publishPostAction, type WriteActionState } from './actions';

const initialState: WriteActionState = {};

type EditorAction = 'bold' | 'italic' | 'paragraph' | 'h1' | 'h2' | 'quote' | 'pullQuote' | 'ul' | 'ol' | 'code';

type ToolbarItem = {
	action: EditorAction;
	icon: LucideIcon;
	label: string;
};

type SlashCommand = ToolbarItem & {
	trigger: string;
};

type FloatingPosition = {
	left: number;
	top: number;
};

type SlashMenuState = FloatingPosition & {
	commands: SlashCommand[];
};

type ActiveFormat = {
	bold: boolean;
	italic: boolean;
	block: EditorAction | null;
};

const blockSelector = 'p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,div';

const selectionToolbar: ToolbarItem[] = [
	{ action: 'bold', icon: Bold, label: 'Bold' },
	{ action: 'italic', icon: Italic, label: 'Italic' },
	{ action: 'h1', icon: Heading1, label: 'Heading 1' },
	{ action: 'h2', icon: Heading2, label: 'Heading 2' },
	{ action: 'quote', icon: Quote, label: 'Quote' },
	{ action: 'pullQuote', icon: TextQuote, label: 'Pull quote' },
];

const slashCommands: SlashCommand[] = [
	{ action: 'paragraph', icon: Type, label: 'Text', trigger: '/p' },
	{ action: 'h1', icon: Heading1, label: 'Heading 1', trigger: '/h1' },
	{ action: 'h2', icon: Heading2, label: 'Heading 2', trigger: '/h2' },
	{ action: 'quote', icon: Quote, label: 'Quote', trigger: '/quote' },
	{ action: 'pullQuote', icon: TextQuote, label: 'Pull quote', trigger: '/pullquote' },
	{ action: 'ul', icon: List, label: 'Bulleted list', trigger: '/ul' },
	{ action: 'ol', icon: ListOrdered, label: 'Numbered list', trigger: '/ol' },
	{ action: 'code', icon: Code2, label: 'Code block', trigger: '/code' },
];

const typedShortcuts = new Map<string, EditorAction>([
	['/p', 'paragraph'],
	['/h1', 'h1'],
	['/h2', 'h2'],
	['/quote', 'quote'],
	['/q', 'quote'],
	['/pullquote', 'pullQuote'],
	['/pull', 'pullQuote'],
	['/pq', 'pullQuote'],
	['/ul', 'ul'],
	['/ol', 'ol'],
	['/code', 'code'],
	['#', 'h1'],
	['##', 'h2'],
	['>', 'quote'],
	['>>', 'pullQuote'],
	['-', 'ul'],
	['1.', 'ol'],
	['```', 'code'],
]);

function getElementFromNode(node: Node | null) {
	if (!node) return null;

	return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
}

function getSelectionInsideEditor(editor: HTMLElement) {
	const selection = window.getSelection();

	if (!selection || !selection.anchorNode || !selection.focusNode) return null;
	if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;

	return selection;
}

function getActiveBlock(editor: HTMLElement) {
	const selection = getSelectionInsideEditor(editor);
	const anchorElement = getElementFromNode(selection?.anchorNode ?? null);
	const block = anchorElement?.closest(blockSelector);

	if (!block || !editor.contains(block)) return null;
	if (block === editor && editor.childNodes.length > 1) return null;

	return block as HTMLElement;
}

function getBlockAction(block: HTMLElement | null, editor: HTMLElement): EditorAction | null {
	if (!block || block === editor) return null;

	const tagName = block.tagName;

	if (tagName === 'H1') return 'h1';
	if (tagName === 'H2') return 'h2';
	if (tagName === 'PRE') return 'code';
	if (tagName === 'BLOCKQUOTE') return block.classList.contains('write-pull-quote') ? 'pullQuote' : 'quote';
	if (tagName === 'LI') return block.closest('ol') ? 'ol' : 'ul';

	return tagName === 'P' ? 'paragraph' : null;
}

function placeCaretAtEnd(element: HTMLElement) {
	const range = document.createRange();
	const selection = window.getSelection();

	range.selectNodeContents(element);
	range.collapse(false);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function createEmptyParagraph(editor: HTMLElement) {
	const paragraph = document.createElement('p');

	paragraph.append(document.createElement('br'));
	editor.append(paragraph);
	placeCaretAtEnd(paragraph);

	return paragraph;
}

function replaceBlockText(block: HTMLElement, editor: HTMLElement) {
	if (block === editor) {
		editor.replaceChildren();

		return createEmptyParagraph(editor);
	}

	block.replaceChildren(document.createElement('br'));
	placeCaretAtEnd(block);

	return block;
}

function replaceBlock(block: HTMLElement, editor: HTMLElement, replacement: HTMLElement) {
	const target = block.tagName === 'LI' ? block.closest('ul,ol') : block;

	if (!replacement.childNodes.length && replacement.tagName !== 'PRE') {
		replacement.append(document.createElement('br'));
	}

	if (!target || target === editor) {
		editor.replaceChildren(replacement);
	} else {
		target.replaceWith(replacement);
	}

	placeCaretAtEnd(replacement);
}

function appendClonedContents(target: HTMLElement, source: HTMLElement) {
	const contents = Array.from(source.childNodes, (node) => node.cloneNode(true));

	target.append(...contents);
}

function createReplacementBlock(action: EditorAction, sourceBlock: HTMLElement, editor: HTMLElement) {
	const replacementTag =
		action === 'paragraph' ? 'p' : action === 'quote' || action === 'pullQuote' ? 'blockquote' : action;
	const replacement = document.createElement(replacementTag);
	const source = sourceBlock === editor ? editor : sourceBlock;

	if (action === 'pullQuote') replacement.classList.add('write-pull-quote');

	if (sourceBlock.tagName === 'PRE') {
		replacement.textContent = sourceBlock.textContent || '';
	} else {
		appendClonedContents(replacement, source);
	}

	return replacement;
}

function transformCurrentBlock(editor: HTMLElement, action: EditorAction) {
	const block = getActiveBlock(editor) ?? createEmptyParagraph(editor);
	const activeAction = getBlockAction(block, editor);
	const nextAction = activeAction === action && action !== 'paragraph' ? 'paragraph' : action;

	if (nextAction === 'ul' || nextAction === 'ol') {
		const list = document.createElement(nextAction === 'ul' ? 'ul' : 'ol');
		const item = document.createElement('li');
		const source = block === editor ? editor : block;

		appendClonedContents(item, source);
		if (!item.textContent?.trim()) item.replaceChildren(document.createElement('br'));
		list.append(item);
		replaceBlock(block, editor, list);
		placeCaretAtEnd(item);

		return;
	}

	if (nextAction === 'code') {
		const pre = document.createElement('pre');

		pre.textContent = block.textContent || '';
		if (!pre.textContent) pre.append(document.createElement('br'));
		replaceBlock(block, editor, pre);

		return;
	}

	const replacement = createReplacementBlock(nextAction, block, editor);

	replaceBlock(block, editor, replacement);
}

function getSelectionRect(selection: Selection) {
	if (!selection.rangeCount) return null;

	const range = selection.getRangeAt(0).cloneRange();
	const rect = range.getBoundingClientRect();

	if (rect.width || rect.height) return rect;

	const anchorElement = getElementFromNode(selection.anchorNode);

	return anchorElement?.getBoundingClientRect() ?? null;
}

function isToolbarItemActive(item: ToolbarItem, activeFormat: ActiveFormat) {
	if (item.action === 'bold') return activeFormat.bold;
	if (item.action === 'italic') return activeFormat.italic;

	return activeFormat.block === item.action;
}

function EditorToolbarButton({
	active,
	item,
	onPress,
}: {
	active: boolean;
	item: ToolbarItem;
	onPress: (action: EditorAction) => void;
}) {
	const Icon = item.icon;

	const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		onPress(item.action);
	};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onMouseDown={handleMouseDown}
					className={
						active
							? 'inline-flex size-9 items-center justify-center rounded-full bg-[var(--editor-action-color-soft)] text-[var(--editor-action-color)] transition hover:bg-[var(--editor-action-color-soft)]'
							: 'inline-flex size-9 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50'
					}
					aria-label={item.label}
					aria-pressed={active}
				>
					<Icon className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent>{item.label}</TooltipContent>
		</Tooltip>
	);
}

function EditorCanvas({
	contentInputRef,
	editorRef,
	error,
	onBlur,
	onInput,
	onKeyDown,
	onKeyUp,
	onMouseUp,
	onTitleChange,
	title,
}: {
	contentInputRef: RefObject<HTMLInputElement | null>;
	editorRef: RefObject<HTMLDivElement | null>;
	error?: string;
	onBlur: () => void;
	onInput: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onKeyUp: () => void;
	onMouseUp: () => void;
	onTitleChange: (title: string) => void;
	title: string;
}) {
	return (
		<main className="mx-auto max-w-3xl px-6 py-10">
			<label htmlFor="story-title" className="sr-only">
				Story title
			</label>
			<textarea
				id="story-title"
				name="title"
				value={title}
				onChange={(event) => onTitleChange(event.target.value)}
				placeholder="Title"
				rows={1}
				className="min-h-20 shrink-0 resize-none border-0 bg-transparent font-serif text-5xl leading-tight text-neutral-950 outline-none placeholder:text-neutral-300 dark:text-neutral-50 dark:placeholder:text-neutral-700 sm:text-6xl"
			/>

			<input ref={contentInputRef} type="hidden" name="content" />

			<div
				ref={editorRef}
				contentEditable
				suppressContentEditableWarning
				role="textbox"
				tabIndex={0}
				aria-label="Story body"
				spellCheck
				onInput={onInput}
				onBlur={onBlur}
				onKeyDown={onKeyDown}
				onKeyUp={onKeyUp}
				onMouseUp={onMouseUp}
				data-placeholder="Tell your story..."
				className="prose prose-xl mt-8 min-h-[45svh] max-w-none bg-white font-serif text-neutral-900 outline-none prose-neutral prose-headings:font-sans prose-headings:font-semibold prose-headings:text-neutral-950 prose-h1:text-5xl prose-h1:leading-tight prose-h2:text-4xl prose-h2:leading-tight prose-p:leading-9 prose-p:text-neutral-900 prose-strong:text-neutral-950 prose-blockquote:border-l-[6px] prose-blockquote:border-neutral-950 prose-blockquote:pl-6 prose-blockquote:text-2xl prose-blockquote:italic prose-pre:rounded-md prose-pre:bg-neutral-950 prose-pre:p-5 prose-pre:text-neutral-100 empty:before:pointer-events-none empty:before:text-neutral-300 empty:before:content-[attr(data-placeholder)] focus:outline-none focus:ring-0 dark:prose-invert dark:bg-neutral-950 dark:text-neutral-200 dark:prose-headings:text-neutral-50 dark:prose-p:text-neutral-200 dark:prose-strong:text-neutral-50 dark:prose-blockquote:border-neutral-200 dark:prose-pre:bg-neutral-950 dark:prose-pre:text-neutral-100 dark:prose-pre:ring-2 dark:prose-pre:ring-inset dark:prose-pre:ring-[#123f3a] dark:empty:before:text-neutral-700"
			/>

			{error && (
				<p className="mt-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
			)}
		</main>
	);
}

function PublishBar({ pending }: { pending: boolean }) {
	return (
		<div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
			<div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
				<p className="text-sm text-neutral-500 dark:text-neutral-400">Draft story</p>
				<div className="flex items-center gap-3">
					<button
						type="submit"
						name="status"
						value="draft"
						disabled={pending}
						className="rounded-full px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
					>
						Save draft
					</button>
					<button
						type="submit"
						name="status"
						value="published"
						disabled={pending}
						className="inline-flex items-center gap-2 rounded-full bg-[var(--editor-action-color)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--editor-action-color-hover)] disabled:opacity-50"
					>
						<Send className="size-4" />
						{pending ? 'Publishing...' : 'Publish'}
					</button>
				</div>
			</div>
		</div>
	);
}

function SelectionToolbar({
	activeFormat,
	onPress,
	position,
}: {
	activeFormat: ActiveFormat;
	onPress: (action: EditorAction) => void;
	position: FloatingPosition | null;
}) {
	if (!position) return null;

	return (
		<div
			className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
			style={{ left: position.left, top: position.top }}
		>
			{selectionToolbar.map((item) => (
				<EditorToolbarButton
					key={item.label}
					active={isToolbarItemActive(item, activeFormat)}
					item={item}
					onPress={onPress}
				/>
			))}
		</div>
	);
}

function SlashCommandMenu({
	menu,
	onSelect,
}: {
	menu: SlashMenuState | null;
	onSelect: (command: SlashCommand) => void;
}) {
	if (!menu) return null;

	return (
		<div
			className="fixed z-50 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
			style={{ left: menu.left, top: menu.top }}
		>
			{menu.commands.map((command) => {
				const Icon = command.icon;

				return (
					<button
						key={command.trigger}
						type="button"
						onMouseDown={(event) => {
							event.preventDefault();
							onSelect(command);
						}}
						className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
					>
						<span className="inline-flex size-8 items-center justify-center rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
							<Icon className="size-4" />
						</span>
						<span className="min-w-0 flex-1 truncate">{command.label}</span>
						<span className="text-xs text-neutral-400 dark:text-neutral-500">{command.trigger}</span>
					</button>
				);
			})}
		</div>
	);
}

export default function WriteEditor() {
	const editorRef = useRef<HTMLDivElement>(null);
	const contentInputRef = useRef<HTMLInputElement>(null);
	const [title, setTitle] = useState('');
	const [activeFormat, setActiveFormat] = useState<ActiveFormat>({ bold: false, italic: false, block: null });
	const [floatingToolbar, setFloatingToolbar] = useState<FloatingPosition | null>(null);
	const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
	const [state, formAction, pending] = useActionState(publishPostAction, initialState);

	const syncContent = useCallback(() => {
		if (!contentInputRef.current) return;

		contentInputRef.current.value = editorRef.current?.innerHTML || '';
	}, []);

	const updateActiveFormat = useCallback(() => {
		const editor = editorRef.current;

		if (!editor || !getSelectionInsideEditor(editor)) {
			setActiveFormat({ bold: false, italic: false, block: null });

			return;
		}

		const block = getActiveBlock(editor);

		setActiveFormat({
			bold: document.queryCommandState('bold'),
			italic: document.queryCommandState('italic'),
			block: getBlockAction(block, editor),
		});
	}, []);

	const updateFloatingToolbar = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;

		const selection = getSelectionInsideEditor(editor);
		updateActiveFormat();

		if (!selection || selection.isCollapsed) {
			setFloatingToolbar(null);

			return;
		}

		const rect = getSelectionRect(selection);
		if (!rect) {
			setFloatingToolbar(null);

			return;
		}

		setFloatingToolbar({
			left: rect.left + rect.width / 2,
			top: Math.max(rect.top - 52, 12),
		});
	}, [updateActiveFormat]);

	const updateSlashMenu = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;

		const selection = getSelectionInsideEditor(editor);
		if (!selection || !selection.isCollapsed) {
			setSlashMenu(null);

			return;
		}

		const block = getActiveBlock(editor);
		const query = block?.textContent?.trim().toLowerCase() ?? '';

		if (!query.startsWith('/') || query.includes(' ')) {
			setSlashMenu(null);

			return;
		}

		const commands = slashCommands.filter((command) => {
			const normalizedLabel = command.label.toLowerCase();
			const normalizedQuery = query.slice(1);

			return command.trigger.startsWith(query) || normalizedLabel.includes(normalizedQuery);
		});

		if (!commands.length) {
			setSlashMenu(null);

			return;
		}

		const rect = getSelectionRect(selection) ?? block?.getBoundingClientRect();

		if (!rect) return;

		setSlashMenu({
			commands,
			left: Math.min(Math.max(rect.left, 16), window.innerWidth - 272),
			top: Math.min(rect.bottom + 12, window.innerHeight - 280),
		});
	}, []);

	const applyEditorAction = useCallback(
		(action: EditorAction) => {
			const editor = editorRef.current;
			if (!editor) return;

			if (!getSelectionInsideEditor(editor)) editor.focus();

			if (action === 'bold' || action === 'italic') {
				document.execCommand(action, false);
			} else {
				transformCurrentBlock(editor, action);
			}

			syncContent();
			setSlashMenu(null);
			window.requestAnimationFrame(() => {
				updateActiveFormat();
				updateFloatingToolbar();
			});
		},
		[syncContent, updateActiveFormat, updateFloatingToolbar],
	);

	const applyTypedShortcut = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== ' ' && event.key !== 'Enter') return false;

			const editor = editorRef.current;
			const block = editor ? getActiveBlock(editor) : null;
			const shortcut = block?.textContent?.trim().toLowerCase() ?? '';
			const action = typedShortcuts.get(shortcut);

			if (!editor || !block || !action) return false;

			event.preventDefault();
			replaceBlockText(block, editor);
			applyEditorAction(action);

			return true;
		},
		[applyEditorAction],
	);

	const handleEditorInput = () => {
		syncContent();
		window.requestAnimationFrame(() => {
			updateActiveFormat();
			updateSlashMenu();
		});
	};

	const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape') {
			setSlashMenu(null);
			setFloatingToolbar(null);

			return;
		}

		applyTypedShortcut(event);
	};

	const handleEditorKeyUp = () => {
		updateFloatingToolbar();
		updateSlashMenu();
	};

	const handleSlashCommand = (command: SlashCommand) => {
		const editor = editorRef.current;
		const block = editor ? getActiveBlock(editor) : null;

		if (!editor || !block) return;

		replaceBlockText(block, editor);
		applyEditorAction(command.action);
	};

	useEffect(() => {
		document.addEventListener('selectionchange', updateFloatingToolbar);

		return () => document.removeEventListener('selectionchange', updateFloatingToolbar);
	}, [updateFloatingToolbar]);

	return (
		<TooltipProvider delayDuration={150}>
			<form
				action={formAction}
				onSubmit={syncContent}
				className="min-h-[calc(100svh-4rem)] bg-white pb-28 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-200"
			>
				<EditorCanvas
					contentInputRef={contentInputRef}
					editorRef={editorRef}
					error={state.error}
					onBlur={syncContent}
					onInput={handleEditorInput}
					onKeyDown={handleEditorKeyDown}
					onKeyUp={handleEditorKeyUp}
					onMouseUp={updateFloatingToolbar}
					onTitleChange={setTitle}
					title={title}
				/>
				<PublishBar pending={pending} />
				<SelectionToolbar activeFormat={activeFormat} onPress={applyEditorAction} position={floatingToolbar} />
				<SlashCommandMenu menu={slashMenu} onSelect={handleSlashCommand} />
			</form>
		</TooltipProvider>
	);
}
