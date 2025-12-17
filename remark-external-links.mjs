import { visit } from 'unist-util-visit';

/**
 * Remark plugin to add target="_blank" and rel="noopener noreferrer" to all links
 */
export default function remarkExternalLinks() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      if (!node.data) {
        node.data = {};
      }
      if (!node.data.hProperties) {
        node.data.hProperties = {};
      }
      node.data.hProperties.target = '_blank';
      node.data.hProperties.rel = 'noopener noreferrer';
    });
  };
}
