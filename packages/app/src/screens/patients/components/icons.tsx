/**
 * This cluster's icons — `lucide-react-native`, wrapped the same way the day
 * view wraps its own (`screens/day/components/icons.tsx`): named after the job,
 * with `stroke`/`width` as props so the library stays swappable from one file.
 * Cluster-local rather than shared because `domain/` does not exist yet; the two
 * wrappers are the same eight lines and belong together when it does.
 *
 * WhatsApp is `MessageCircle`: Lucide carries no brand marks, and a traced logo
 * is how a project ends up with two icon sets and a trademark question.
 */
import { MessageCircle, Pencil, Phone, Plus, Search, X } from 'lucide-react-native';
import { color } from '../../../theme';

type IconProps = {
    size?: number;
    stroke?: string;
    width?: number;
};

type Glyph = typeof Phone;

function icon(Glyph: Glyph, defaultWidth = 2) {
    return function Wrapped({ size = 15, stroke = color.muted, width = defaultWidth }: IconProps) {
        return <Glyph size={size} color={stroke} strokeWidth={width} />;
    };
}

export const WhatsAppIcon = icon(MessageCircle);
export const CallIcon = icon(Phone);

// The list's three. `patients-list.html` draws them heavier than the record's
// two — 2.2 on the magnifier, 2.4 on the plus and the row chevron — so the
// default width is per-glyph rather than set at every call site.
export const SearchIcon = icon(Search, 2.2);
export const PlusIcon = icon(Plus, 2.4);

// The editor's Cancel. `patient-edit.html` draws it at 2.4 in the same round
// white button the record's back sits in — a cross and not a chevron, because
// leaving an editor abandons an edit rather than walking back a step.
export const CloseIcon = icon(X, 2.4);

// The way into the editor from the record bar. Lighter than the bar's other two
// glyphs: it opens a screen rather than leaving one, and the name below it is
// what the eye should land on first.
export const EditIcon = icon(Pencil, 2);
