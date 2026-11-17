// Everything the editor page needs from TipTap/ProseMirror, exposed as window.TT.
// The editor's own nodes and wiring live in app/ui/editor.js so they can change without a rebuild.
import * as core from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import * as textStyle from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';
import * as table from '@tiptap/extension-table';
import * as extensions from '@tiptap/extensions';
import * as pmState from '@tiptap/pm/state';
import * as pmModel from '@tiptap/pm/model';
import * as pmView from '@tiptap/pm/view';

window.TT = { core, StarterKit, TextAlign, textStyle, Image, table, extensions, pmState, pmModel, pmView };
