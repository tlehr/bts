'use strict';

// Same eligibility as the match integration loop. Hidden planning/entry nodes
// and reverse-home-away records still belong to the dependency graph.
module.exports = node => !!(node?.IsMatch?.[0] && !node.ReverseHomeAway);
