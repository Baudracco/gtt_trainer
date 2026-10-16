<?php
declare(strict_types=1);
namespace GttTrainer;

/** Stable GTT-specific numeric error identifiers; machine-code strings remain backwards compatible. */
final class ErrorCatalog
{
    /** @var array<string,int> Numbers are never reassigned to a different meaning. */
    public const NUMBERS = [
        'invalid_json'=>2001, 'invalid_credentials'=>2002, 'authentication_required'=>2003,
        'permission_denied'=>2004, 'csrf_failed'=>2005, 'not_found'=>2006,
        'version_conflict'=>2007, 'invalid_transition'=>2008, 'stop_conflict'=>2009,
        'data_conflict'=>2010, 'payload_too_large'=>2011, 'unsupported_media_type'=>2012,
        'media_too_large'=>2013, 'unsupported_media'=>2014, 'invalid_range'=>2015,
        'invalid_media'=>2016, 'validation_failed'=>2017, 'publication_incomplete'=>2018,
        'rate_limited'=>2019, 'internal_error'=>2099,
    ];

    /** Resolve a public machine code; unknown internal failures use the opaque internal-error number. */
    public static function number(string $code): int {return self::NUMBERS[$code] ?? self::NUMBERS['internal_error'];}
}
